import { Platform } from 'react-native';

let armedCamera: Promise<MediaStream> | null = null;
let cameraListeners = 0;

export function retainCameraListener() {
  cameraListeners += 1;
  return () => {
    cameraListeners -= 1;
  };
}

export function cameraListenerCount() {
  return cameraListeners;
}

export function armLiveCamera() {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return;
  }
  const previous = armedCamera;
  armedCamera = navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' } },
  });
  if (previous) {
    void previous.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => undefined);
  }
}

export function hasArmedCamera() {
  return armedCamera !== null;
}

export function armedCameraPromise() {
  return armedCamera;
}

export function claimArmedCamera(pending: Promise<MediaStream>) {
  if (armedCamera === pending) armedCamera = null;
}
