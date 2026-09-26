import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { unstable_createElement as createDomElement } from 'react-native-web';

import type { AppThemeColors } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';
import {
  detectCans,
  loadCanDetector,
  subscribeDetectorProgress,
  type CanHit,
} from '@/vision/canDetector';

const FRAME_EDGE = 640;
const CHECK_PAUSE_MS = 800;

type CameraPhase = 'off' | 'starting' | 'on';

type ContentFrame = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type PlacedBox = ContentFrame & {
  score: number;
};

export function CanCamera() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [requested, setRequested] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [cameraPhase, setCameraPhase] = useState<CameraPhase>('off');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  const [mirror, setMirror] = useState(true);
  const [hits, setHits] = useState<CanHit[]>([]);
  const [frame, setFrame] = useState<ContentFrame | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);

  const cameraSupported =
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

  const setVideoNode = useCallback((node: unknown) => {
    if (node instanceof HTMLVideoElement) {
      setVideo((current) => (current === node ? current : node));
    }
  }, []);

  useEffect(() => {
    videoRef.current = video;
  }, [video]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!requested) {
      return;
    }

    let cancelled = false;
    const unsubscribe = subscribeDetectorProgress((progress) => {
      if (!cancelled) {
        setDownloadPercent(progress.percent);
      }
    });

    loadCanDetector()
      .then(() => {
        if (!cancelled) {
          setModelReady(true);
        }
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) {
          setModelReady(false);
          setModelError('The detector did not download. Check the connection and try again.');
        }
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [requested, loadAttempt]);

  useEffect(() => {
    if (cameraPhase !== 'on' || !video) {
      return;
    }

    const observer = new ResizeObserver(() => {
      setFrame(contentFrame(video));
    });
    observer.observe(video);
    return () => {
      observer.disconnect();
    };
  }, [cameraPhase, video]);

  useEffect(() => {
    if (cameraPhase !== 'on' || !modelReady || watchError || !video) {
      return;
    }

    let stopped = false;
    let timer = 0;

    const tick = async () => {
      if (stopped) {
        return;
      }
      if (video.readyState < 2 || video.videoWidth === 0) {
        timer = window.setTimeout(() => {
          void tick();
        }, 200);
        return;
      }

      try {
        const canvas = drawFrame(video, canvasRef);
        const nextHits = await detectCans(canvas);
        if (stopped) {
          return;
        }
        setHits(nextHits);
        setFrame(contentFrame(video));
        setHasResult(true);
      } catch (error) {
        console.error(error);
        if (!stopped) {
          setWatchError('The frame check failed. Try again.');
        }
        return;
      }

      if (!stopped) {
        timer = window.setTimeout(() => {
          void tick();
        }, CHECK_PAUSE_MS);
      }
    };

    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [cameraPhase, modelReady, video, watchError]);

  const startCamera = useCallback(async () => {
    const node = videoRef.current;
    if (!cameraSupported) {
      setCameraError('This browser cannot open a camera here.');
      return;
    }
    if (!node) {
      return;
    }

    setRequested(true);
    setCameraError(null);
    setWatchError(null);
    setCameraPhase('starting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (!mountedRef.current) {
        stopStream(stream);
        return;
      }
      await playCamera(node, stream);
      streamRef.current = stream;
      const facingMode = stream.getVideoTracks()[0]?.getSettings().facingMode;
      setMirror(facingMode !== 'environment');
      setCameraPhase('on');
    } catch (error) {
      console.error(error);
      if (!mountedRef.current) {
        return;
      }
      setCameraPhase('off');
      setCameraError(cameraMessage(error));
    }
  }, [cameraSupported]);

  const retry = useCallback(() => {
    setWatchError(null);
    setHits([]);
    setHasResult(false);
    if (modelError) {
      setModelError(null);
      setLoadAttempt((attempt) => attempt + 1);
    }
    if (cameraPhase !== 'on') {
      void startCamera();
    }
  }, [cameraPhase, modelError, startCamera]);

  const boxes = useMemo(() => placeBoxes(hits, frame, mirror), [hits, frame, mirror]);
  const status = statusCopy({
    cameraError,
    cameraPhase,
    cameraSupported,
    downloadPercent,
    hasResult,
    hits,
    modelError,
    modelReady,
    requested,
    watchError,
  });
  const showStart = cameraSupported && cameraPhase === 'off' && !cameraError;
  const showRetry = cameraError !== null || modelError !== null || watchError !== null;

  return (
    <View style={styles.block}>
      <View
        style={[
          styles.stage,
          hits.length > 0 ? styles.stageFound : null,
        ]}
      >
        {createDomElement('video', {
          ref: setVideoNode,
          muted: true,
          playsInline: true,
          autoPlay: true,
          'aria-hidden': true,
          style: videoDomStyle(mirror),
        })}
        <View style={styles.overlay}>
          {boxes.map((box, index) => (
            <View
              key={`${index}-${box.score}`}
              style={[
                styles.box,
                {
                  left: box.left,
                  top: box.top,
                  width: box.width,
                  height: box.height,
                },
              ]}
            >
              <Text style={styles.boxLabel}>{Math.round(box.score * 100)}%</Text>
            </View>
          ))}
        </View>
        {cameraPhase !== 'on' ? (
          <View style={styles.prompt}>
            <Text style={styles.promptTitle}>
              {cameraPhase === 'starting' ? 'Starting the camera…' : 'Camera is off'}
            </Text>
            {showStart ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void startCamera();
                }}
                style={styles.promptButton}
              >
                <Text style={styles.buttonText}>Start camera</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.status, hits.length > 0 ? styles.statusFound : null]}
      >
        {status}
      </Text>
      {showRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={retry}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      ) : null}
      <Text style={styles.caption}>
        The detector downloads once, about 150 MB, and stays in this browser. A box means it sees an aluminum can.
      </Text>
    </View>
  );
}

function statusCopy(input: {
  cameraError: string | null;
  cameraPhase: CameraPhase;
  cameraSupported: boolean;
  downloadPercent: number | null;
  hasResult: boolean;
  hits: CanHit[];
  modelError: string | null;
  modelReady: boolean;
  requested: boolean;
  watchError: string | null;
}): string {
  if (!input.cameraSupported) {
    return 'This browser cannot open a camera here.';
  }
  if (input.cameraError) {
    return input.cameraError;
  }
  if (input.modelError) {
    return input.modelError;
  }
  if (input.watchError) {
    return input.watchError;
  }
  if (input.requested && !input.modelReady) {
    return input.downloadPercent === null
      ? 'Loading the detector…'
      : `Loading the detector… ${input.downloadPercent}%`;
  }
  if (input.cameraPhase !== 'on') {
    return 'Start the camera to check for an aluminum can.';
  }
  if (!input.hasResult) {
    return 'Checking the frame…';
  }
  if (input.hits.length > 0) {
    const score = Math.round(input.hits[0].score * 100);
    return input.hits.length === 1
      ? `Aluminum can in view · ${score}%`
      : `${input.hits.length} aluminum cans in view · ${score}%`;
  }
  return 'No aluminum can in view';
}

function playCamera(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  return video.play().then(() => undefined);
}

function cameraMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Camera access was blocked. Allow the camera for this site, then try again.';
    }
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
      return 'No camera was found on this device.';
    }
  }
  return 'The camera did not start.';
}

function drawFrame(
  video: HTMLVideoElement,
  canvasRef: { current: HTMLCanvasElement | null },
): HTMLCanvasElement {
  const canvas = canvasRef.current ?? document.createElement('canvas');
  canvasRef.current = canvas;
  const scale = Math.min(1, FRAME_EDGE / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not read the camera frame.');
  }
  context.drawImage(video, 0, 0, width, height);
  return canvas;
}

function contentFrame(video: HTMLVideoElement): ContentFrame | null {
  const elementWidth = video.clientWidth;
  const elementHeight = video.clientHeight;
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  if (elementWidth <= 0 || elementHeight <= 0 || videoWidth <= 0 || videoHeight <= 0) {
    return null;
  }
  const scale = Math.min(elementWidth / videoWidth, elementHeight / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  return {
    left: (elementWidth - width) / 2,
    top: (elementHeight - height) / 2,
    width,
    height,
  };
}

function placeBoxes(hits: CanHit[], frame: ContentFrame | null, mirror: boolean): PlacedBox[] {
  if (!frame) {
    return [];
  }
  return hits.map((hit) => {
    const xmin = mirror ? 1 - hit.xmax : hit.xmin;
    const xmax = mirror ? 1 - hit.xmin : hit.xmax;
    return {
      score: hit.score,
      left: frame.left + xmin * frame.width,
      top: frame.top + hit.ymin * frame.height,
      width: Math.max(0, (xmax - xmin) * frame.width),
      height: Math.max(0, (hit.ymax - hit.ymin) * frame.height),
    };
  });
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => {
    track.stop();
  });
}

function videoDomStyle(mirror: boolean) {
  return {
    position: 'absolute' as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
    objectFit: 'contain' as const,
    backgroundColor: '#000000',
    transform: mirror ? 'scaleX(-1)' : 'none',
  };
}

function createStyles(colors: AppThemeColors) {
  return StyleSheet.create({
    block: {
      marginTop: 20,
      flex: 1,
    },
    stage: {
      flex: 1,
      minHeight: 280,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      backgroundColor: '#000000',
    },
    stageFound: {
      borderColor: colors.positive,
      borderWidth: 2,
    },
    overlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      pointerEvents: 'none',
    },
    prompt: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      backgroundColor: 'rgba(0, 0, 0, 0.45)',
    },
    promptTitle: {
      color: '#ffffff',
      fontSize: 18,
      fontWeight: '700',
      textAlign: 'center',
    },
    box: {
      position: 'absolute',
      borderWidth: 3,
      borderColor: colors.positive,
      borderRadius: 8,
    },
    boxLabel: {
      alignSelf: 'flex-start',
      margin: 4,
      overflow: 'hidden',
      backgroundColor: colors.positive,
      color: '#ffffff',
      fontSize: 12,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
    },
    status: {
      marginTop: 14,
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
    },
    statusFound: {
      color: colors.positive,
    },
    promptButton: {
      alignSelf: 'center',
      marginTop: 16,
      backgroundColor: colors.brand,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    button: {
      alignSelf: 'flex-start',
      marginTop: 16,
      backgroundColor: colors.brand,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    buttonText: {
      color: colors.onBrand,
      fontWeight: '600',
    },
    caption: {
      marginTop: 10,
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
  });
}
