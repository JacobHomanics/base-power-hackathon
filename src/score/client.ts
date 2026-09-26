import { decide, sightingFromModel, type HomeScore } from '@/score/decide';

export type PhotoPayload = {
  mime: string;
  data: string;
  previewUrl: string;
};

const MAX_EDGE = 1400;

export type SetupState = {
  status: 'idle' | 'downloading' | 'starting' | 'ready' | 'error';
  loaded: number;
  total: number;
  message: string;
};

export function checkerUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return `http://127.0.0.1:8787${path}`;
  return path;
}

export async function fetchSetup(): Promise<SetupState> {
  const response = await fetch(checkerUrl('/api/setup'));
  if (!response.ok) throw new Error('Setup is unavailable.');
  return (await response.json()) as SetupState;
}

export async function startSetup(): Promise<SetupState> {
  const response = await fetch(checkerUrl('/api/setup'), { method: 'POST' });
  const body = (await response.json().catch(() => null)) as SetupState | { error?: string } | null;
  if (!response.ok) {
    throw new Error(body && 'error' in body && body.error ? body.error : 'Setup could not start.');
  }
  return body as SetupState;
}

export async function photoFromBlob(blob: Blob): Promise<PhotoPayload> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Couldn't read that photo.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const jpeg = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error("Couldn't read that photo."));
      }, 'image/jpeg', 0.82);
    });
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    return { mime: 'image/jpeg', data: encodeBase64(bytes), previewUrl: URL.createObjectURL(jpeg) };
  } finally {
    bitmap.close();
  }
}

export async function scorePhotos(photos: PhotoPayload[]): Promise<HomeScore> {
  if (photos.length === 0) throw new Error('Add a photo of the meter or the main switch.');
  let response: Response;
  try {
    response = await fetch(checkerUrl('/api/score'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        images: photos.slice(0, 8).map((photo) => ({ mime: photo.mime, data: photo.data })),
      }),
    });
  } catch {
    throw new Error('The photo checker is still starting. Wait a moment and try the photo again.');
  }
  const body = (await response.json().catch(() => null)) as { model?: string; error?: string } | null;
  if (!response.ok) throw new Error(body?.error || 'The photo check failed.');
  if (!body?.model) throw new Error('The photo checker returned an empty answer.');
  return decide(sightingFromModel(body.model));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
