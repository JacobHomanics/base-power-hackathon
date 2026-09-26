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

import { ScreenHeader } from '@/components/ScreenHeader';
import { APP_BRAND_HEX } from '@/constants/brand';
import type { AppThemeColors } from '@/constants/theme';
import {
  analyzePhoto,
  detectorSupported,
  modelIsCached,
  prepareModel,
  readyBackend,
  type PhotoAnalysis,
} from '@/detector/engine';
import type { CanBox } from '@/detector/types';
import manifest from '@/detector/manifest.json';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useIsDesktopWeb } from '@/hooks/useIsDesktopWeb';

type Phase =
  | { status: 'checking' }
  | { status: 'missing' }
  | { status: 'downloading'; loaded: number; total: number }
  | { status: 'starting' }
  | { status: 'ready'; backend: string }
  | { status: 'error'; message: string };

type Job =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; analysis: PhotoAnalysis }
  | { status: 'failed'; message: string };

const MODEL_MB = Math.round(manifest.bytes / 1_000_000);

export function HomeScreen() {
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const isDesktop = useIsDesktopWeb();
  const [phase, setPhase] = useState<Phase>(
    detectorSupported ? { status: 'checking' } : { status: 'error', message: '' },
  );
  const [job, setJob] = useState<Job>({ status: 'idle' });
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const previewRef = useRef<string | null>(null);
  const runId = useRef(0);
  const dropRef = useRef<View>(null);
  const runBytesRef = useRef<(bytes: Uint8Array, mime: string, name: string) => void>(() => undefined);

  const replacePreview = useCallback((next: string | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = next;
    setPreviewUri(next);
  }, []);

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  const ensureReady = useCallback(async () => {
    const existing = readyBackend();
    if (existing) {
      setPhase({ status: 'ready', backend: existing });
      return;
    }
    try {
      if (await modelIsCached()) setPhase({ status: 'starting' });
      else setPhase({ status: 'downloading', loaded: 0, total: manifest.bytes });
      const { backend } = await prepareModel({
        onProgress: (loaded, total) => setPhase({ status: 'downloading', loaded, total }),
        onStarting: () => setPhase({ status: 'starting' }),
      });
      setPhase({ status: 'ready', backend });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The detector failed to start.';
      setPhase({ status: 'error', message });
      throw error;
    }
  }, []);

  const runBytes = useCallback(
    async (bytes: Uint8Array, mime: string, name: string) => {
      const id = ++runId.current;
      const blob = new Blob([bytesToBuffer(bytes)], { type: mime || 'image/*' });
      replacePreview(URL.createObjectURL(blob));
      setJob({ status: 'running' });
      try {
        await ensureReady();
        if (id !== runId.current) return;
        const analysis = await analyzePhoto(bytes, mime);
        if (id !== runId.current) return;
        if (analysis.boxes.length > 0 && Platform.OS === 'web') {
          try {
            replacePreview(await markCans(bytes, mime, analysis.boxes));
          } catch {
            // The unmarked preview is already on screen.
          }
        }
        if (id !== runId.current) return;
        setJob({ status: 'done', analysis });
      } catch (error) {
        if (id !== runId.current) return;
        setJob({
          status: 'failed',
          message: error instanceof Error ? error.message : `Couldn't check ${name}.`,
        });
      }
    },
    [ensureReady, replacePreview],
  );

  useEffect(() => {
    runBytesRef.current = (bytes, mime) => {
      void runBytes(bytes, mime, 'photo');
    };
  }, [runBytes]);

  useEffect(() => {
    if (!detectorSupported) return;
    let cancelled = false;
    void (async () => {
      setPhase({ status: 'checking' });
      const cached = await modelIsCached();
      if (cancelled) return;
      if (!cached) {
        setPhase({ status: 'missing' });
        return;
      }
      try {
        await ensureReady();
      } catch {
        // ensureReady records the message on phase.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureReady]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
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
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      void file.arrayBuffer().then((buffer) => {
        runBytesRef.current(new Uint8Array(buffer), file.type || 'image/*', file.name);
      });
    };

    node.addEventListener('dragover', onDragOver);
    node.addEventListener('dragleave', onDragLeave);
    node.addEventListener('drop', onDrop);
    return () => {
      node.removeEventListener('dragover', onDragOver);
      node.removeEventListener('dragleave', onDragLeave);
      node.removeEventListener('drop', onDrop);
    };
  }, [phase.status]);

  const busy =
    phase.status === 'checking' ||
    phase.status === 'downloading' ||
    phase.status === 'starting' ||
    job.status === 'running';

  const choosePhoto = useCallback(() => {
    if (Platform.OS !== 'web' || busy) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.arrayBuffer().then((buffer) => {
        void runBytes(new Uint8Array(buffer), file.type || 'image/*', file.name);
      });
    };
    input.click();
  }, [busy, runBytes]);

  const loadSample = useCallback(
    (path: string, name: string) => {
      if (busy) return;
      void (async () => {
        const response = await fetch(path);
        if (!response.ok) throw new Error('The sample photo is missing.');
        const buffer = await response.arrayBuffer();
        await runBytes(new Uint8Array(buffer), 'image/jpeg', name);
      })().catch((error: unknown) => {
        setJob({
          status: 'failed',
          message: error instanceof Error ? error.message : 'The sample photo failed to load.',
        });
      });
    },
    [busy, runBytes],
  );

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 },
      ]}
      style={styles.scroll}
    >
      <ScreenHeader
        subtitle="Upload a picture. A model running in this browser looks for an aluminum can. The file stays on this device."
        title="Find a can"
      />

      {detectorSupported ? (
        <>
          <View style={styles.card}>
            <ModelStatus phase={phase} styles={styles} />
            {phase.status === 'missing' || phase.status === 'error' ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => {
                  void ensureReady().catch(() => undefined);
                }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.pressed,
                  busy && styles.disabled,
                ]}
              >
                <Text style={styles.primaryLabel}>
                  {phase.status === 'error' ? 'Try again' : `Download detector (${MODEL_MB} MB)`}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {previewUri ? (
            <View style={isDesktop ? styles.resultRow : styles.resultStack}>
              <View style={styles.previewFrame}>
                <Image
                  accessibilityLabel="Selected photo"
                  resizeMode="contain"
                  source={{ uri: previewUri }}
                  style={styles.preview}
                />
              </View>
              <VerdictCard colors={colors} isDark={isDark} job={job} styles={styles} />
            </View>
          ) : null}

          <View ref={dropRef} style={[styles.drop, dragActive && styles.dropActive]}>
            <Text style={styles.dropTitle}>Drop a photo here</Text>
            <Text style={styles.dropBody}>JPEG, PNG, or WebP. Detection happens in the browser.</Text>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={choosePhoto}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.pressed,
                  busy && styles.disabled,
                ]}
              >
                <Text style={styles.primaryLabel}>Choose a photo</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => loadSample('/samples/can.jpg', 'Can sample')}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.pressed,
                  busy && styles.disabled,
                ]}
              >
                <Text style={styles.secondaryLabel}>Sample with a can</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => loadSample('/samples/photo.jpg', 'Apollo 11 sample')}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.pressed,
                  busy && styles.disabled,
                ]}
              >
                <Text style={styles.secondaryLabel}>Sample without a can</Text>
              </Pressable>
            </View>
            <Text style={styles.fine}>
              Can sample: Patrick Fitzgerald, CC BY 2.0. Other sample: Apollo 11, NASA.
            </Text>
          </View>

          <Text style={styles.credit}>
            YOLOv8n trained on drink cans and food cans from the{' '}
            <Text
              accessibilityRole="link"
              onPress={() => {
                void Linking.openURL(manifest.sourceRepo);
              }}
              style={styles.link}
            >
              TACO dataset
            </Text>
            . A can is outlined when its score clears {Math.round(manifest.threshold * 100)}%.
          </Text>
        </>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Open this page in a browser</Text>
          <Text style={styles.cardBody}>
            Detection runs in the browser with WebAssembly, on this device. Use the web app to check
            a photo.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function ModelStatus({
  phase,
  styles,
}: {
  phase: Phase;
  styles: ReturnType<typeof createStyles>;
}) {
  if (phase.status === 'checking') {
    return (
      <View style={styles.statusRow}>
        <ActivityIndicator />
        <Text style={styles.cardBody}>Checking for a saved copy of the model…</Text>
      </View>
    );
  }
  if (phase.status === 'missing') {
    return (
      <>
        <Text style={styles.cardTitle}>Download the model once</Text>
        <Text style={styles.cardBody}>
          The can detector is {MODEL_MB} MB. It downloads from this site, stays on this device, and
          runs without sending the photo anywhere.
        </Text>
      </>
    );
  }
  if (phase.status === 'downloading') {
    const ratio = phase.total > 0 ? Math.min(1, phase.loaded / phase.total) : 0;
    return (
      <>
        <Text style={styles.cardTitle}>Downloading the detector</Text>
        <Text style={styles.cardBody}>
          {formatMb(phase.loaded)} of {formatMb(phase.total || manifest.bytes)}
        </Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
        </View>
      </>
    );
  }
  if (phase.status === 'starting') {
    return (
      <View style={styles.statusRow}>
        <ActivityIndicator />
        <Text style={styles.cardBody}>Starting the model. The first run compiles it for this browser.</Text>
      </View>
    );
  }
  if (phase.status === 'ready') {
    return (
      <Text style={styles.cardBody}>
        Ready on this device · {phase.backend}
      </Text>
    );
  }
  return (
    <>
      <Text style={styles.cardTitle}>Detector setup failed</Text>
      <Text style={styles.cardBody}>{phase.message}</Text>
    </>
  );
}

function VerdictCard({
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
        <Text style={styles.cardBody}>Analyzing the photo…</Text>
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
  const { analysis } = job;
  const tone = tonePalette(analysis.tone, colors, isDark);
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.verdict, { backgroundColor: tone.background, borderColor: tone.foreground }]}
    >
      {analysis.percent !== null ? (
        <Text style={[styles.percent, { color: tone.foreground }]}>{analysis.percent}%</Text>
      ) : null}
      <Text style={[styles.verdictLabel, { color: tone.foreground }]}>{analysis.label}</Text>
      <Text style={styles.cardBody}>{analysis.detail}</Text>
    </View>
  );
}

function tonePalette(
  tone: PhotoAnalysis['tone'],
  colors: AppThemeColors,
  isDark: boolean,
): { foreground: string; background: string } {
  if (tone === 'can') {
    return { foreground: isDark ? '#6ee7b7' : '#067647', background: isDark ? '#123328' : '#e7f6ee' };
  }
  if (tone === 'clear') return { foreground: colors.text, background: colors.surface };
  return { foreground: colors.textSecondary, background: colors.surface };
}

async function markCans(bytes: Uint8Array, mime: string, boxes: CanBox[]): Promise<string> {
  const blob = new Blob([bytesToBuffer(bytes)], { type: mime || 'image/*' });
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return URL.createObjectURL(blob);
    ctx.drawImage(bitmap, 0, 0);
    ctx.strokeStyle = APP_BRAND_HEX;
    ctx.lineWidth = Math.max(3, Math.round(bitmap.width / 180));
    for (const box of boxes) {
      ctx.strokeRect(
        box.x * bitmap.width,
        box.y * bitmap.height,
        box.width * bitmap.width,
        box.height * bitmap.height,
      );
    }
    const marked = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92);
    });
    return URL.createObjectURL(marked ?? blob);
  } finally {
    bitmap.close();
  }
}

function formatMb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function bytesToBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
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
    },
    cardBody: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    track: {
      height: 8,
      borderRadius: 999,
      backgroundColor: colors.border,
      overflow: 'hidden',
    },
    fill: {
      height: '100%',
      backgroundColor: colors.brand,
    },
    drop: {
      marginTop: 16,
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
    fine: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textMuted,
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
    previewFrame: {
      flex: 1,
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
      minHeight: 280,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: 20,
      gap: 8,
      justifyContent: 'flex-start',
    },
    percent: {
      fontSize: 56,
      fontWeight: '700',
      lineHeight: 60,
    },
    verdictLabel: {
      fontSize: 22,
      fontWeight: '700',
    },
    credit: {
      marginTop: 20,
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
