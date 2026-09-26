// Letterbox to the YOLO input size. Padding gray is 114, matching Ultralytics.

import manifest from '@/detector/manifest.json';

export type Letterbox = {
  tensor: Float32Array;
  width: number;
  height: number;
  gain: number;
  padX: number;
  padY: number;
};

const MAX_PIXELS = 24_000_000;

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  const bitmap = await createImageBitmap(blob);
  const pixels = bitmap.width * bitmap.height;
  if (pixels <= MAX_PIXELS) return bitmap;
  const scale = Math.sqrt(MAX_PIXELS / pixels);
  try {
    const resized = await createImageBitmap(bitmap, {
      resizeWidth: Math.max(1, Math.round(bitmap.width * scale)),
      resizeHeight: Math.max(1, Math.round(bitmap.height * scale)),
    });
    bitmap.close();
    return resized;
  } catch {
    return bitmap;
  }
}

export async function letterboxImage(bytes: Uint8Array, mime: string): Promise<Letterbox> {
  const size = manifest.inputSize;
  const blob = new Blob([bytesToArrayBuffer(bytes)], { type: mime || 'image/*' });
  const bitmap = await loadBitmap(blob);
  try {
    const { width, height } = bitmap;
    if (width < 32 || height < 32) {
      throw new Error('This image is too small to search.');
    }
    const gain = Math.min(size / height, size / width);
    const resizedW = Math.max(1, Math.round(width * gain));
    const resizedH = Math.max(1, Math.round(height * gain));
    const padX = Math.round((size - width * gain) / 2 - 0.1);
    const padY = Math.round((size - height * gain) / 2 - 0.1);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not read pixels from this image.');
    ctx.fillStyle = 'rgb(114,114,114)';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(bitmap, padX, padY, resizedW, resizedH);
    const { data } = ctx.getImageData(0, 0, size, size);

    const tensor = new Float32Array(3 * size * size);
    const plane = size * size;
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      tensor[p] = data[i] / 255;
      tensor[plane + p] = data[i + 1] / 255;
      tensor[2 * plane + p] = data[i + 2] / 255;
    }
    return { tensor, width, height, gain, padX, padY };
  } finally {
    bitmap.close();
  }
}
