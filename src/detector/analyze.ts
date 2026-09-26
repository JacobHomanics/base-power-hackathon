import manifest from '@/detector/manifest.json';
import { letterboxImage, type Letterbox } from '@/detector/preprocess';
import { detectTensor } from '@/detector/session';
import type { CanBox, PhotoAnalysis } from '@/detector/types';

type RawBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
};

function iou(a: RawBox, b: RawBox): number {
  const left = Math.max(a.x1, b.x1);
  const top = Math.max(a.y1, b.y1);
  const right = Math.min(a.x2, b.x2);
  const bottom = Math.min(a.y2, b.y2);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const intersection = width * height;
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = areaA + areaB - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function nms(boxes: RawBox[]): RawBox[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept: RawBox[] = [];
  for (const box of sorted) {
    if (kept.every((other) => iou(other, box) < manifest.iou)) kept.push(box);
  }
  return kept.slice(0, 20);
}

function readScore(data: Float32Array, dims: readonly number[], index: number, classOffset: number): number {
  const channels = dims[1] ?? 0;
  const anchors = dims[2] ?? 0;
  if (channels > 0 && channels < anchors) return data[classOffset * anchors + index];
  const row = dims[2] ?? 0;
  return data[index * row + classOffset];
}

function readChannel(
  data: Float32Array,
  dims: readonly number[],
  index: number,
  channel: number,
): number {
  return readScore(data, dims, index, channel);
}

function anchorCount(dims: readonly number[]): number {
  const a = dims[1] ?? 0;
  const b = dims[2] ?? 0;
  if (a > 0 && a < b) return b;
  return a;
}

function rawDetections(data: Float32Array, dims: readonly number[], prepared: Letterbox): CanBox[] {
  const count = anchorCount(dims);
  const channels = Math.min(dims[1] ?? 0, dims[2] ?? 0);
  if (count === 0 || channels < 5) return [];
  const found: RawBox[] = [];
  for (let i = 0; i < count; i += 1) {
    let score = 0;
    for (let c = 4; c < channels; c += 1) {
      score = Math.max(score, readChannel(data, dims, i, c));
    }
    if (score < manifest.threshold) continue;
    const cx = readChannel(data, dims, i, 0);
    const cy = readChannel(data, dims, i, 1);
    const w = readChannel(data, dims, i, 2);
    const h = readChannel(data, dims, i, 3);
    found.push({
      x1: cx - w / 2,
      y1: cy - h / 2,
      x2: cx + w / 2,
      y2: cy + h / 2,
      score,
    });
  }
  return nms(found).map((box) => toImageBox(box, prepared));
}

function toImageBox(box: RawBox, prepared: Letterbox): CanBox {
  const x1 = clamp((box.x1 - prepared.padX) / prepared.gain, 0, prepared.width);
  const y1 = clamp((box.y1 - prepared.padY) / prepared.gain, 0, prepared.height);
  const x2 = clamp((box.x2 - prepared.padX) / prepared.gain, 0, prepared.width);
  const y2 = clamp((box.y2 - prepared.padY) / prepared.gain, 0, prepared.height);
  return {
    x: x1 / prepared.width,
    y: y1 / prepared.height,
    width: Math.max(0, x2 - x1) / prepared.width,
    height: Math.max(0, y2 - y1) / prepared.height,
    score: box.score,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function verdict(boxes: CanBox[]): PhotoAnalysis {
  if (boxes.length === 0) {
    return {
      status: 'scored',
      tone: 'clear',
      label: 'No aluminum can',
      detail: 'Nothing in this photo scored as a drink can or a food can.',
      percent: null,
      boxes,
    };
  }
  const top = boxes.reduce((best, box) => (box.score > best.score ? box : best), boxes[0]);
  const count = boxes.length === 1 ? '1 can' : `${boxes.length} cans`;
  return {
    status: 'scored',
    tone: 'can',
    label: 'Aluminum can',
    detail: `${count}, highest confidence ${Math.round(top.score * 100)}%.`,
    percent: Math.round(top.score * 100),
    boxes,
  };
}

export async function analyzePhoto(bytes: Uint8Array, mime: string): Promise<PhotoAnalysis> {
  let prepared: Letterbox;
  try {
    prepared = await letterboxImage(bytes, mime);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'This image could not be read.';
    return {
      status: 'skipped',
      tone: 'muted',
      label: 'Could not check',
      detail: message,
      percent: null,
      boxes: [],
    };
  }
  const output = await detectTensor(prepared.tensor);
  return verdict(rawDetections(output.data, output.dims, prepared));
}
