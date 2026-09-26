// Pixel prep ported from Sieve (MIT) so scores match the Pillow bilinear
// pipeline used to train and evaluate the model.
// https://github.com/Phineas1500/sieve-ai-image-detector

import manifest from '@/detector/manifest.json';

export type RGBAImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

const MEAN = manifest.normMean;
const STD = manifest.normStd;

function pass(
  data: ArrayLike<number>,
  sw: number,
  sh: number,
  dsize: number,
  horizontal: boolean,
): Float32Array {
  const srcSize = horizontal ? sw : sh;
  const scale = srcSize / dsize;
  const filterscale = Math.max(scale, 1);
  const support = filterscale;
  const ow = horizontal ? dsize : sw;
  const oh = horizontal ? sh : dsize;
  const out = new Float32Array(ow * oh * 4);
  const bounds: [number, Float32Array][] = [];

  for (let i = 0; i < dsize; i++) {
    const center = (i + 0.5) * scale;
    const lo = Math.max(0, Math.floor(center - support));
    const hi = Math.min(srcSize, Math.ceil(center + support));
    const weights = new Float32Array(hi - lo);
    let sum = 0;
    for (let k = lo; k < hi; k++) {
      const t = Math.abs((k + 0.5 - center) / filterscale);
      const value = t < 1 ? 1 - t : 0;
      weights[k - lo] = value;
      sum += value;
    }
    if (sum > 0) {
      for (let k = 0; k < weights.length; k++) weights[k] = (weights[k] ?? 0) / sum;
    }
    bounds.push([lo, weights]);
  }

  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const bound = bounds[horizontal ? x : y];
      if (!bound) continue;
      const [lo, weights] = bound;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < weights.length; k++) {
        const weight = weights[k] ?? 0;
        const j = horizontal ? (y * sw + lo + k) * 4 : ((lo + k) * sw + x) * 4;
        r += (data[j] ?? 0) * weight;
        g += (data[j + 1] ?? 0) * weight;
        b += (data[j + 2] ?? 0) * weight;
      }
      const o = (y * ow + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  return out;
}

export function resamplePIL(src: RGBAImage, dw: number, dh: number): RGBAImage {
  let data: ArrayLike<number> = pass(src.data, src.width, src.height, dw, true);
  data = pass(data, dw, src.height, dh, false);
  const clamped = new Uint8ClampedArray(dw * dh * 4);
  for (let i = 0; i < data.length; i++) clamped[i] = Math.round(data[i] ?? 0);
  return { data: clamped, width: dw, height: dh };
}

function cropRGBA(src: RGBAImage, x0: number, y0: number, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const start = ((y0 + y) * src.width + x0) * 4;
    out.set(src.data.subarray(start, start + size * 4), y * size * 4);
  }
  return out;
}

function toTensor(data: Uint8ClampedArray, size: number): Float32Array {
  const [mr, mg, mb] = MEAN;
  const [sr, sg, sb] = STD;
  const n = size * size;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    out[i] = ((data[j] ?? 0) / 255 - mr) / sr;
    out[n + i] = ((data[j + 1] ?? 0) / 255 - mg) / sg;
    out[2 * n + i] = ((data[j + 2] ?? 0) / 255 - mb) / sb;
  }
  return out;
}

function resizeAndCrop(img: RGBAImage, shorterSide: number): Float32Array {
  const size = manifest.inputSize;
  const scale = shorterSide / Math.min(img.width, img.height);
  const rw = Math.max(size, Math.round(img.width * scale));
  const rh = Math.max(size, Math.round(img.height * scale));
  const resized = resamplePIL(img, rw, rh);
  const data = cropRGBA(resized, Math.floor((rw - size) / 2), Math.floor((rh - size) / 2), size);
  return toTensor(data, size);
}

export function preprocess(img: RGBAImage): Float32Array {
  return resizeAndCrop(img, manifest.resizeShorterSide);
}

export function preprocessFit(img: RGBAImage): Float32Array {
  return resizeAndCrop(img, manifest.inputSize);
}

export function preprocessNative(img: RGBAImage): Float32Array {
  const size = manifest.inputSize;
  const data = cropRGBA(
    img,
    Math.floor((img.width - size) / 2),
    Math.floor((img.height - size) / 2),
    size,
  );
  return toTensor(data, size);
}

export function degradationStats(img: RGBAImage): { block: number; d12: number } {
  const { data, width, height } = img;
  if (width < 24 || height < 24) return { block: 1, d12: 1 };
  const luma = (index: number) =>
    0.299 * (data[index] ?? 0) + 0.587 * (data[index + 1] ?? 0) + 0.114 * (data[index + 2] ?? 0);
  const sy = Math.max(1, Math.floor(height / 192));
  let dxAll = 0;
  let dxN = 0;
  let dxB = 0;
  let dxBN = 0;
  let dyAll = 0;
  let dyN = 0;
  let dyB = 0;
  let dyBN = 0;
  let d2All = 0;
  for (let y = 1; y < height - 1; y += sy) {
    const row = y * width * 4;
    const next = (y + 1) * width * 4;
    let prev = luma(row);
    for (let x = 1; x < width - 1; x++) {
      const i = row + x * 4;
      const c = luma(i);
      const r = luma(i + 4);
      const d = luma(next + x * 4);
      const dx = Math.abs(r - c);
      const dy = Math.abs(d - c);
      dxAll += dx;
      dxN++;
      dyAll += dy;
      dyN++;
      d2All += Math.abs(r - prev);
      if (x % 8 === 7) {
        dxB += dx;
        dxBN++;
      }
      if (y % 8 === 7) {
        dyB += dy;
        dyBN++;
      }
      prev = c;
    }
  }
  const bx = dxBN ? dxB / dxBN / (dxAll / dxN + 1e-6) : 1;
  const by = dyBN ? dyB / dyBN / (dyAll / dyN + 1e-6) : 1;
  return { block: (bx + by) / 2, d12: dxAll / dxN / (d2All / dxN + 1e-6) };
}

export function degenerateReason(img: RGBAImage): 'flat' | 'noise' | null {
  const { data, width, height } = img;
  const sy = Math.max(1, height >> 7);
  let n = 0;
  let sum = 0;
  let sum2 = 0;
  let m = 0;
  let sa = 0;
  let sb = 0;
  let sab = 0;
  let sa2 = 0;
  let sb2 = 0;
  for (let y = 0; y < height; y += sy) {
    const row = y * width * 4;
    let prev = -1;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      const l =
        0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
      n++;
      sum += l;
      sum2 += l * l;
      if (prev >= 0) {
        m++;
        sa += prev;
        sb += l;
        sab += prev * l;
        sa2 += prev * prev;
        sb2 += l * l;
      }
      prev = l;
    }
  }
  const variance = sum2 / n - (sum / n) ** 2;
  if (variance < 4) return 'flat';
  const cov = sab / m - (sa / m) * (sb / m);
  const denom = Math.sqrt(Math.max((sa2 / m - (sa / m) ** 2) * (sb2 / m - (sb / m) ** 2), 1e-9));
  if (cov / denom < 0.15) return 'noise';
  return null;
}
