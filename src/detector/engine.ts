import type { PhotoAnalysis, PrepareListener } from '@/detector/types';

export const detectorSupported: boolean = false;

export type { PhotoAnalysis, PrepareListener };

export function readyBackend(): string | null {
  return null;
}

export function modelIsCached(): Promise<boolean> {
  return Promise.resolve(false);
}

export function prepareModel(_listener?: PrepareListener): Promise<{ backend: string }> {
  return Promise.reject(new Error('Open this app in a browser to run the detector.'));
}

export function analyzePhoto(_bytes: Uint8Array, _mime: string): Promise<PhotoAnalysis> {
  return Promise.reject(new Error('Open this app in a browser to run the detector.'));
}
