import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  armedCameraPromise,
  cameraListenerCount,
  claimArmedCamera,
  hasArmedCamera,
  retainCameraListener,
} from '@/camera/live';
import { BreakerOverlay } from '@/camera/BreakerOverlay';
import { MeterOverlay } from '@/camera/MeterOverlay';
import { ScreenHeader } from '@/components/ScreenHeader';
import type { AppThemeColors } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useIsDesktopWeb } from '@/hooks/useIsDesktopWeb';
import { photoFromBlob, scorePhotos, type PhotoPayload } from '@/score/client';
import { QUESTIONS, type Check, type HomeScore, type Outcome } from '@/score/decide';

type Job =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; score: HomeScore }
  | { status: 'failed'; message: string };

const SHOT_SCALES = [1, 0.75, 0.55, 0.38];

function cameraHint(step: 'meter' | 'breaker', shotIndex: number): string {
  if (step === 'meter') {
    return shotIndex === 0
      ? 'Center the meter in the outline.'
      : 'Step back and fit the meter in the smaller outline.';
  }
  return shotIndex === 0
    ? 'Now center the breaker in the outline.'
    : 'Step back and fit the breaker in the smaller outline.';
}

export function HomeScreen() {
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const isDesktop = useIsDesktopWeb();
  const [job, setJob] = useState<Job>({ status: 'idle' });
  const [photos, setPhotos] = useState<PhotoPayload[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [camera, setCamera] = useState<'off' | 'opening' | 'live' | 'blocked'>(
    hasArmedCamera() ? 'opening' : 'off',
  );
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const [step, setStep] = useState<'meter' | 'breaker'>('meter');
  const [shotIndex, setShotIndex] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const photosRef = useRef<PhotoPayload[]>([]);
  const pendingShotsRef = useRef<PhotoPayload[]>([]);
  const captureToken = useRef(0);
  const runId = useRef(0);
  const dropRef = useRef<View>(null);
  const cameraFrameRef = useRef<View>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scoreFilesRef = useRef<(files: File[]) => void>(() => undefined);

  const replacePhotos = useCallback((next: PhotoPayload[]) => {
    for (const photo of photosRef.current) URL.revokeObjectURL(photo.previewUrl);
    photosRef.current = next;
    setPhotos(next);
  }, []);

  const discardPendingShots = useCallback(() => {
    captureToken.current += 1;
    for (const photo of pendingShotsRef.current) URL.revokeObjectURL(photo.previewUrl);
    pendingShotsRef.current = [];
    setStep('meter');
    setShotIndex(0);
    setCapturing(false);
  }, []);
  const discardPendingShotsRef = useRef(discardPendingShots);
  discardPendingShotsRef.current = discardPendingShots;

  const closeCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    videoRef.current = null;
    setCamera('off');
    discardPendingShots();
  }, [discardPendingShots]);

  useEffect(() => {
    return () => {
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.previewUrl);
      for (const photo of pendingShotsRef.current) URL.revokeObjectURL(photo.previewUrl);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const pending = armedCameraPromise();
      if (!pending || Platform.OS !== 'web') return undefined;
      const release = retainCameraListener();
      let alive = true;
      setCameraMessage(null);
      setCamera('opening');
      void pending
        .then((stream) => {
          const replaced = armedCameraPromise() !== pending;
          if (!alive || replaced) {
            if (replaced || cameraListenerCount() === 0) {
              stream.getTracks().forEach((track) => track.stop());
            }
            return;
          }
          claimArmedCamera(pending);
          streamRef.current?.getTracks().forEach((track) => track.stop());
          streamRef.current = stream;
          setCamera('live');
        })
        .catch(() => {
          if (!alive || armedCameraPromise() !== pending) return;
          claimArmedCamera(pending);
          setCamera('blocked');
          setCameraMessage('This browser could not open the camera. Choose a photo instead.');
        });
      return () => {
        alive = false;
        release();
        discardPendingShotsRef.current();
        const stream = streamRef.current;
        if (!stream) return;
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        videoRef.current = null;
        setCamera('off');
      };
    }, []),
  );

  useEffect(() => {
    if (camera !== 'live' || Platform.OS !== 'web') return;
    const node = cameraFrameRef.current as unknown as HTMLElement | null;
    const stream = streamRef.current;
    if (!node || !stream) return;
    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.style.position = 'absolute';
    video.style.inset = '0';
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';
    video.style.display = 'block';
    node.replaceChildren(video);
    videoRef.current = video;
    return () => {
      videoRef.current = null;
      node.replaceChildren();
    };
  }, [camera]);

  const runPayloads = useCallback(
    async (payloads: PhotoPayload[]) => {
      const id = ++runId.current;
      replacePhotos(payloads);
      setJob({ status: 'running' });
      try {
        const score = await scorePhotos(payloads);
        if (id !== runId.current) return;
        setJob({ status: 'done', score });
      } catch (error) {
        if (id !== runId.current) return;
        setJob({
          status: 'failed',
          message: error instanceof Error ? error.message : 'The photo check failed.',
        });
      }
    },
    [replacePhotos],
  );

  const scoreFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((file) => file.type.startsWith('image/')).slice(0, 8);
      if (images.length === 0) {
        setJob({ status: 'failed', message: 'Choose a JPEG, PNG, or WebP photo.' });
        return;
      }
      try {
        const payloads = await Promise.all(images.map((file) => photoFromBlob(file)));
        await runPayloads(payloads);
      } catch (error) {
        setJob({
          status: 'failed',
          message: error instanceof Error ? error.message : "Couldn't read that photo.",
        });
      }
    },
    [runPayloads],
  );

  useEffect(() => {
    scoreFilesRef.current = (files) => {
      void scoreFiles(files);
    };
  }, [scoreFiles]);

  const cameraOpen = camera === 'live' || camera === 'opening';

  useEffect(() => {
    if (Platform.OS !== 'web' || cameraOpen) return;
    const node = dropRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;

    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      setDragActive(true);
    };
    const onDragLeave = () => setDragActive(false);
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      setDragActive(false);
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length === 0) return;
      scoreFilesRef.current(files);
    };

    node.addEventListener('dragover', onDragOver);
    node.addEventListener('dragleave', onDragLeave);
    node.addEventListener('drop', onDrop);
    return () => {
      node.removeEventListener('dragover', onDragOver);
      node.removeEventListener('dragleave', onDragLeave);
      node.removeEventListener('drop', onDrop);
    };
  }, [cameraOpen]);

  const busy = job.status === 'running';

  const openCamera = useCallback(() => {
    if (Platform.OS !== 'web' || busy) return;
    setCameraMessage(null);
    setCamera('opening');
    void navigator.mediaDevices
      .getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } })
      .then((stream) => {
        streamRef.current = stream;
        setCamera('live');
      })
      .catch(() => {
        setCamera('blocked');
        setCameraMessage('This browser could not open the camera. Choose a photo instead.');
      });
  }, [busy]);

  const takePicture = useCallback(() => {
    const video = videoRef.current;
    if (capturing || !video || video.videoWidth === 0) {
      if (!capturing) setCameraMessage('The camera is still starting.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCameraMessage("Couldn't read that photo.");
      return;
    }
    ctx.drawImage(video, 0, 0);
    const current = step;
    const index = shotIndex;
    const token = captureToken.current;
    setCapturing(true);
    canvas.toBlob((blob) => {
      if (token !== captureToken.current) return;
      if (!blob) {
        setCapturing(false);
        setCameraMessage("Couldn't read that photo.");
        return;
      }
      void photoFromBlob(blob)
        .then((payload) => {
          if (token !== captureToken.current) {
            URL.revokeObjectURL(payload.previewUrl);
            return;
          }
          pendingShotsRef.current = [...pendingShotsRef.current, payload];
          setCameraMessage(null);
          setCapturing(false);
          const lastInSet = index >= SHOT_SCALES.length - 1;
          if (!lastInSet) {
            setShotIndex(index + 1);
            return;
          }
          if (current === 'meter') {
            setStep('breaker');
            setShotIndex(0);
            return;
          }
          const taken = pendingShotsRef.current;
          pendingShotsRef.current = [];
          setStep('meter');
          setShotIndex(0);
          closeCamera();
          void runPayloads(taken);
        })
        .catch((error: unknown) => {
          if (token !== captureToken.current) return;
          setCapturing(false);
          setCameraMessage(error instanceof Error ? error.message : "Couldn't read that photo.");
        });
    }, 'image/jpeg', 0.92);
  }, [capturing, closeCamera, runPayloads, shotIndex, step]);

  const choosePhoto = useCallback(() => {
    if (Platform.OS !== 'web' || busy) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => {
      const files = [...(input.files ?? [])];
      if (files.length === 0) return;
      closeCamera();
      void scoreFiles(files);
    };
    input.click();
  }, [busy, closeCamera, scoreFiles]);

  const loadSample = useCallback(
    (path: string) => {
      if (busy) return;
      void (async () => {
        const response = await fetch(path);
        if (!response.ok) throw new Error('The sample photo is missing.');
        const blob = await response.blob();
        await runPayloads([await photoFromBlob(blob)]);
      })().catch((error: unknown) => {
        setJob({
          status: 'failed',
          message: error instanceof Error ? error.message : 'The sample photo failed to load.',
        });
      });
    },
    [busy, runPayloads],
  );

  if (cameraOpen && Platform.OS === 'web') {
    return (
      <View style={styles.cameraScreen}>
        <View ref={cameraFrameRef} style={styles.cameraFill} />
        <View pointerEvents="box-none" style={styles.cameraOverlay}>
          <View style={[styles.cameraHintBar, { paddingTop: insets.top + 16 }]}>
            <Text style={styles.cameraHint}>{cameraHint(step, shotIndex)}</Text>
            <Text style={styles.cameraCount}>
              {shotIndex + 1} of {SHOT_SCALES.length}
            </Text>
          </View>
          <View pointerEvents="none" style={styles.cameraGuide}>
            {step === 'meter' ? (
              <MeterOverlay scale={SHOT_SCALES[shotIndex]} />
            ) : (
              <BreakerOverlay scale={SHOT_SCALES[shotIndex]} />
            )}
          </View>
          <View style={[styles.cameraDock, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            {cameraMessage ? <Text style={styles.cameraMessage}>{cameraMessage}</Text> : null}
            {camera === 'live' ? (
              <Pressable
                accessibilityLabel={
                  step === 'meter'
                    ? `Take meter picture ${shotIndex + 1} of ${SHOT_SCALES.length}`
                    : `Take breaker picture ${shotIndex + 1} of ${SHOT_SCALES.length}`
                }
                accessibilityRole="button"
                disabled={busy || capturing}
                onPress={takePicture}
                style={({ pressed }) => [
                  styles.shutter,
                  pressed && styles.pressed,
                  (busy || capturing) && styles.disabled,
                ]}
              >
                <View style={styles.shutterCore} />
              </Pressable>
            ) : (
              <View style={styles.opening}>
                <ActivityIndicator color="#ffffff" />
                <Text style={styles.cameraMessage}>Opening the camera…</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 },
      ]}
      style={styles.scroll}
    >
      <ScreenHeader
        subtitle="A few photos of the meter, then the breaker. Step back when the outline shrinks."
        title="Take a picture"
      />

      {Platform.OS === 'web' ? (
        <>
          <View ref={dropRef} style={[styles.drop, dragActive && styles.dropActive]}>
            <Text style={styles.dropTitle}>Take a picture of the meter</Text>
            <Text style={styles.dropBody}>
              The outline starts large, then shrinks so the next photos are from farther back. Then
              the same for the breaker. The photos stay on this computer. You can also drop photos
              here.
            </Text>
            {cameraMessage ? <Text style={styles.cardBody}>{cameraMessage}</Text> : null}
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={openCamera}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.pressed,
                  busy && styles.disabled,
                ]}
              >
                <Text style={styles.primaryLabel}>Take a picture</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={choosePhoto}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.pressed,
                  busy && styles.disabled,
                ]}
              >
                <Text style={styles.secondaryLabel}>Choose a photo</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => loadSample('/samples/main-switch.jpg')}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.pressed,
                  busy && styles.disabled,
                ]}
              >
                <Text style={styles.secondaryLabel}>Sample: main switch</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => loadSample('/samples/closed-lid.jpg')}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.pressed,
                  busy && styles.disabled,
                ]}
              >
                <Text style={styles.secondaryLabel}>Sample: lid closed</Text>
              </Pressable>
            </View>
          </View>

          {photos.length > 0 ? (
            <View style={isDesktop ? styles.resultRow : styles.resultStack}>
              <View style={styles.previewColumn}>
                {photos.map((photo) => (
                  <View key={photo.previewUrl} style={styles.previewFrame}>
                    <Image
                      accessibilityLabel="Home photo"
                      resizeMode="contain"
                      source={{ uri: photo.previewUrl }}
                      style={styles.preview}
                    />
                  </View>
                ))}
              </View>
              <ScoreBanner colors={colors} isDark={isDark} job={job} styles={styles} />
            </View>
          ) : null}

          <View style={styles.questions}>
            {QUESTIONS.map((item) => {
              const check = job.status === 'done' ? job.score.checks.find((entry) => entry.id === item.id) : null;
              return (
                <QuestionCard
                  key={item.id}
                  answer={check?.answer}
                  checkId={item.id}
                  colors={colors}
                  detail={item.detail}
                  isDark={isDark}
                  question={item.question}
                  status={check?.status}
                  styles={styles}
                />
              );
            })}
          </View>

          <Text style={styles.credit}>
            200 amps fits two batteries. 100 to 199 fits one. Under 100 fits none. Solar needs 200
            amps. The other two questions go to a person unless the photo makes them obvious.
          </Text>
          <Text style={styles.credit}>
            Main switch sample:{' '}
            <Text
              accessibilityRole="link"
              onPress={() => {
                void Linking.openURL(
                  'https://commons.wikimedia.org/wiki/File:Stab-Lok_circuit_breaker_panel_interior_.jpg',
                );
              }}
              style={styles.link}
            >
              Repeater-reclaim, CC BY-SA 4.0
            </Text>
            . Closed lid:{' '}
            <Text
              accessibilityRole="link"
              onPress={() => {
                void Linking.openURL(
                  'https://commons.wikimedia.org/wiki/File:Eaton_circuit_breaker_panel_closed.JPG',
                );
              }}
              style={styles.link}
            >
              BrokenSphere, CC BY-SA 3.0
            </Text>
            .
          </Text>
        </>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Open this page in a browser</Text>
          <Text style={styles.cardBody}>
            The photo check runs on this computer. Use the web app to score a home.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function ScoreBanner({
  job,
  styles,
  colors,
  isDark,
}: {
  job: Job;
  styles: ReturnType<typeof createStyles>;
  colors: AppThemeColors;
  isDark: boolean;
}) {
  if (job.status === 'running') {
    return (
      <View style={styles.verdict}>
        <ActivityIndicator />
        <Text style={styles.cardTitle}>Reading the photos</Text>
        <Text style={styles.cardBody}>Looking for the number on the main switch, and for a photo that needs a retake.</Text>
      </View>
    );
  }
  if (job.status === 'failed') {
    return (
      <View style={styles.verdict}>
        <Text style={styles.cardTitle}>Check failed</Text>
        <Text style={styles.cardBody}>{job.message}</Text>
      </View>
    );
  }
  if (job.status !== 'done') return null;
  const tone = outcomeTone(job.score.outcome, colors, isDark);
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.verdict, { backgroundColor: tone.background, borderColor: tone.foreground }]}
    >
      <Text style={[styles.verdictLabel, { color: tone.foreground }]}>{headline(job.score)}</Text>
      <Text style={styles.cardBody}>{job.score.reason}</Text>
    </View>
  );
}

function QuestionCard({
  question,
  detail,
  answer,
  status,
  checkId,
  styles,
  colors,
  isDark,
}: {
  question: string;
  detail: string;
  answer?: string;
  status?: Check['status'];
  checkId: Check['id'];
  styles: ReturnType<typeof createStyles>;
  colors: AppThemeColors;
  isDark: boolean;
}) {
  const retake = checkId === 'photos' && status === 'fail';
  const tone = status
    ? outcomeTone(retake || status === 'unsure' ? 'unsure' : status === 'pass' ? 'yes' : 'no', colors, isDark)
    : null;
  const label = !status ? null : retake ? 'Retake' : status === 'pass' ? 'Yes' : status === 'fail' ? 'No' : 'Not sure';
  return (
    <View style={[styles.question, tone ? { borderLeftColor: tone.foreground } : null]}>
      <View style={styles.questionHead}>
        <Text style={styles.cardTitle}>{question}</Text>
        {label && tone ? <Text style={[styles.pill, { color: tone.foreground }]}>{label}</Text> : null}
      </View>
      <Text style={styles.cardBody}>{answer ?? detail}</Text>
    </View>
  );
}

function headline(score: HomeScore): string {
  if (score.outcome === 'yes') return `✅ ${score.headline}`;
  if (score.outcome === 'unsure') return `🟡 ${score.headline}`;
  if (score.outcome === 'no') return `❌ ${score.headline}`;
  return score.headline;
}

function outcomeTone(
  outcome: Outcome | 'yes' | 'unsure' | 'no',
  colors: AppThemeColors,
  isDark: boolean,
): { foreground: string; background: string } {
  if (outcome === 'yes') {
    return { foreground: isDark ? '#6ee7b7' : '#067647', background: isDark ? '#123328' : '#e7f6ee' };
  }
  if (outcome === 'no') {
    return { foreground: colors.error, background: isDark ? '#3b1515' : '#fdeceb' };
  }
  return { foreground: isDark ? '#fbbf24' : '#b54708', background: isDark ? '#3b2a10' : '#fff6e8' };
}

function createStyles(colors: AppThemeColors) {
  return StyleSheet.create({
    scroll: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      flexGrow: 1,
      width: '100%',
      maxWidth: 880,
      alignSelf: 'center',
      paddingHorizontal: 24,
    },
    card: {
      marginTop: 24,
      padding: 20,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      gap: 12,
    },
    cardTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      flexShrink: 1,
    },
    cardBody: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
    },
    drop: {
      marginTop: 24,
      padding: 24,
      borderRadius: 16,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.border,
      backgroundColor: colors.surface,
      gap: 8,
    },
    dropActive: {
      borderColor: colors.brand,
    },
    cameraScreen: {
      flex: 1,
      backgroundColor: '#000000',
    },
    cameraFill: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: '#000000',
    },
    cameraOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'space-between',
    },
    cameraGuide: {
      flex: 1,
    },
    cameraHintBar: {
      paddingHorizontal: 24,
      paddingBottom: 20,
      backgroundColor: 'rgba(0, 0, 0, 0.35)',
    },
    cameraHint: {
      color: '#ffffff',
      fontSize: 16,
      lineHeight: 22,
      textAlign: 'center',
      textShadowColor: 'rgba(0, 0, 0, 0.85)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 8,
    },
    cameraCount: {
      marginTop: 6,
      color: 'rgba(255, 255, 255, 0.82)',
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
    },
    cameraDock: {
      alignItems: 'center',
      gap: 18,
      paddingTop: 28,
      paddingBottom: 12,
      paddingHorizontal: 24,
      backgroundColor: 'rgba(0, 0, 0, 0.45)',
    },
    cameraMessage: {
      color: '#ffffff',
      fontSize: 15,
      lineHeight: 22,
      textAlign: 'center',
    },
    shutter: {
      width: 78,
      height: 78,
      borderRadius: 39,
      borderWidth: 4,
      borderColor: '#ffffff',
      alignItems: 'center',
      justifyContent: 'center',
    },
    shutterCore: {
      width: 62,
      height: 62,
      borderRadius: 31,
      backgroundColor: '#ffffff',
    },
    opening: {
      minHeight: 78,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    },
    dropTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.text,
    },
    dropBody: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginTop: 8,
    },
    primaryButton: {
      backgroundColor: colors.brand,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    primaryLabel: {
      color: colors.onBrand,
      fontSize: 15,
      fontWeight: '700',
    },
    secondaryButton: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    secondaryLabel: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    pressed: {
      opacity: 0.8,
    },
    disabled: {
      opacity: 0.5,
    },
    resultRow: {
      marginTop: 16,
      flexDirection: 'row',
      gap: 16,
      alignItems: 'stretch',
    },
    resultStack: {
      marginTop: 16,
      gap: 16,
    },
    previewColumn: {
      flex: 1,
      gap: 12,
    },
    previewFrame: {
      height: 280,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    preview: {
      width: '100%',
      height: '100%',
    },
    verdict: {
      flex: 1,
      minHeight: 180,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: 20,
      gap: 8,
      justifyContent: 'flex-start',
    },
    verdictLabel: {
      fontSize: 28,
      fontWeight: '700',
      lineHeight: 34,
    },
    questions: {
      marginTop: 16,
      gap: 12,
    },
    question: {
      padding: 16,
      paddingLeft: 18,
      borderRadius: 16,
      borderWidth: 1,
      borderLeftWidth: 4,
      borderColor: colors.border,
      borderLeftColor: colors.border,
      backgroundColor: colors.surface,
      gap: 6,
    },
    questionHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    },
    pill: {
      fontSize: 14,
      fontWeight: '700',
    },
    credit: {
      marginTop: 16,
      fontSize: 13,
      lineHeight: 20,
      color: colors.textMuted,
    },
    link: {
      color: colors.brandAccent,
      textDecorationLine: 'underline',
    },
  });
}
