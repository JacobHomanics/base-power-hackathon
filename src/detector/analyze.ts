import { decodeRGBA } from '@/detector/decode';
import { metadataDetail, sniffMetadata } from '@/detector/forensics';
import {
  degenerateReason,
  degradationStats,
  preprocess,
  preprocessFit,
  preprocessNative,
} from '@/detector/preprocess';
import manifest from '@/detector/manifest.json';
import { scoreTensor } from '@/detector/session';
import type { PhotoAnalysis } from '@/detector/types';
import { calibrate, degradationNote, metadataVerdict, scoredVerdict, skippedVerdict } from '@/detector/verdict';

const MAX_PIXELS = 24_000_000;

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export async function analyzePhoto(bytes: Uint8Array, mime: string): Promise<PhotoAnalysis> {
  const sniffed = sniffMetadata(bytes);
  if (sniffed.hit && sniffed.reason) {
    return metadataVerdict(sniffed.reason, metadataDetail(sniffed.reason));
  }

  let image;
  try {
    image = await decodeRGBA(new Blob([bytesToArrayBuffer(bytes)], { type: mime || 'image/*' }));
  } catch {
    throw new Error('This file could not be decoded. Use a JPEG, PNG, or WebP.');
  }

  if (image.width < 32 || image.height < 32) {
    return skippedVerdict('too-small', image.width, image.height);
  }
  if (image.width * image.height > MAX_PIXELS) {
    throw new Error('This image is very large. Export a copy under 24 megapixels and try again.');
  }
  const degenerate = degenerateReason(image);
  if (degenerate) return skippedVerdict(degenerate, image.width, image.height);

  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  const quality = degradationStats(image);
  const degraded = quality.block >= 1.8 || quality.d12 < 0.528;
  const started = performance.now();
  const first = await scoreTensor(preprocess(image));
  const cfg = manifest.tta;
  const probability = calibrate(first.logit);
  const large = Math.min(image.width, image.height) >= cfg.minSide;
  let logit = first.logit;
  let secondView = false;
  if (cfg.enabled && probability >= cfg.bandLo && probability <= cfg.bandHi) {
    const second = await scoreTensor(large ? preprocessNative(image) : preprocessFit(image));
    logit = (first.logit + second.logit) / 2;
    secondView = true;
  }
  const milliseconds = Math.round(performance.now() - started);
  return scoredVerdict({
    score: calibrate(logit),
    degraded,
    note: degradationNote(quality.block, quality.d12),
    width: image.width,
    height: image.height,
    backend: first.backend,
    milliseconds,
    secondView,
  });
}
