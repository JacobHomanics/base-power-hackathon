// Decode ported from Sieve (MIT). Canvas readback is checked against a known
// image because fingerprinting noise can look like a generator artifact.
// https://github.com/Phineas1500/sieve-ai-image-detector

import { CANVAS_PROBE_PNG_BASE64, CANVAS_PROBE_RGB_BASE64 } from '@/detector/probeData';
import type { RGBAImage } from '@/detector/preprocess';

type Readback = {
  drawImage: (image: CanvasImageSource, dx: number, dy: number) => void;
  getImageData: (sx: number, sy: number, sw: number, sh: number) => { data: Uint8ClampedArray };
};

type DecodedFrame = {
  codedWidth: number;
  codedHeight: number;
  visibleRect: { x: number; y: number; width: number; height: number } | null;
  allocationSize: (options: object) => number;
  copyTo: (
    destination: Uint8ClampedArray,
    options: object,
  ) => Promise<{ stride: number; offset: number }[]>;
  close: () => void;
};

type ImageDecoderLike = {
  decode: () => Promise<{ image: DecodedFrame }>;
  close: () => void;
};

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const CANVAS_PROBE_PNG = decodeBase64(CANVAS_PROBE_PNG_BASE64);
const CANVAS_PROBE_RGB = decodeBase64(CANVAS_PROBE_RGB_BASE64);

function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasDecode(blob: Blob): Promise<RGBAImage> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = makeCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Readback | null;
    if (!ctx) throw new Error('Could not read pixels from this image.');
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { data, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

function imageDecoderCtor():
  | (new (init: { data: ArrayBuffer; type: string }) => ImageDecoderLike)
  | null {
  const ctor = (globalThis as { ImageDecoder?: new (init: { data: ArrayBuffer; type: string }) => ImageDecoderLike })
    .ImageDecoder;
  return typeof ctor === 'function' ? ctor : null;
}

async function webcodecsDecode(blob: Blob): Promise<RGBAImage> {
  const Decoder = imageDecoderCtor();
  if (!Decoder) throw new Error('WebCodecs is unavailable.');
  const dec = new Decoder({ data: await blob.arrayBuffer(), type: blob.type || 'image/*' });
  const { image: frame } = await dec.decode();
  try {
    const rect = frame.visibleRect ?? {
      x: 0,
      y: 0,
      width: frame.codedWidth,
      height: frame.codedHeight,
    };
    const options = { format: 'RGBA', colorSpace: 'srgb', rect };
    const buf = new Uint8ClampedArray(frame.allocationSize(options));
    const [layout] = await frame.copyTo(buf, options);
    const width = rect.width;
    const height = rect.height;
    let data = buf;
    if (layout && (layout.stride !== width * 4 || layout.offset !== 0)) {
      data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        data.set(
          buf.subarray(layout.offset + y * layout.stride, layout.offset + y * layout.stride + width * 4),
          y * width * 4,
        );
      }
    }
    return { data, width, height };
  } finally {
    frame.close();
    dec.close();
  }
}

let canvasTrustworthy: boolean | null = null;

async function probeCanvasIntegrity(): Promise<boolean> {
  try {
    const { data } = await canvasDecode(
      new Blob([bytesToArrayBuffer(CANVAS_PROBE_PNG)], { type: 'image/png' }),
    );
    for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
      if (
        data[i] !== CANVAS_PROBE_RGB[p] ||
        data[i + 1] !== CANVAS_PROBE_RGB[p + 1] ||
        data[i + 2] !== CANVAS_PROBE_RGB[p + 2]
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function decodeRGBA(blob: Blob): Promise<RGBAImage> {
  if (canvasTrustworthy === null) canvasTrustworthy = await probeCanvasIntegrity();
  if (!canvasTrustworthy && imageDecoderCtor()) {
    try {
      return await webcodecsDecode(blob);
    } catch {
      // An unsupported container still has to decode. Noisy canvas beats no pixels.
    }
  }
  return canvasDecode(blob);
}
