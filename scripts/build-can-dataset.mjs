// Builds a YOLO dataset of drink cans and food cans from TACO annotations.
// Images stay outside the repo. Usage: node scripts/build-can-dataset.mjs

import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const annotationsPath = process.argv[2] ?? '/tmp/taco-annotations.json';
const root = process.argv[3] ?? '/tmp/can-yolo';
const a = JSON.parse(await readFile(annotationsPath, 'utf8'));
const CAN = new Set([10, 12]);

for (const splitName of ['train', 'val']) {
  mkdirSync(path.join(root, 'images', splitName), { recursive: true });
  mkdirSync(path.join(root, 'labels', splitName), { recursive: true });
}

const byImage = new Map();
for (const ann of a.annotations) {
  if (!byImage.has(ann.image_id)) byImage.set(ann.image_id, []);
  byImage.get(ann.image_id).push(ann);
}

const positives = [];
const negatives = [];
for (const img of a.images) {
  const anns = byImage.get(img.id) || [];
  const cans = anns.filter((x) => CAN.has(x.category_id));
  if (cans.length) positives.push({ img, cans });
  else negatives.push({ img, cans: [] });
}
negatives.sort((x, y) => x.img.id - y.img.id);
const pickedNeg = negatives.slice(0, positives.length);

function split(items) {
  const train = [];
  const val = [];
  items.forEach((item, i) => {
    (i % 5 === 0 ? val : train).push(item);
  });
  return { train, val };
}
const pos = split(positives);
const neg = split(pickedNeg);

function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let o = 2;
  while (o + 8 < buf.length) {
    if (buf[o] !== 0xff) {
      o += 1;
      continue;
    }
    const marker = buf[o + 1];
    const len = buf.readUInt16BE(o + 2);
    if (marker >= 0xc0 && marker <= 0xc2) {
      return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
    }
    if (len < 2) break;
    o += 2 + len;
  }
  return null;
}

async function fetchImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const size = jpegSize(buf);
  if (!size) throw new Error(`not jpeg ${url}`);
  return { buf, ...size };
}

function yoloLines(cans, ow, oh, dw, dh) {
  const sx = dw / ow;
  const sy = dh / oh;
  return cans
    .map((ann) => {
      const [x, y, w, h] = ann.bbox;
      const cx = ((x + w / 2) * sx) / dw;
      const cy = ((y + h / 2) * sy) / dh;
      const nw = (w * sx) / dw;
      const nh = (h * sy) / dh;
      const clamp = (v) => Math.max(0, Math.min(1, v));
      return `0 ${clamp(cx).toFixed(6)} ${clamp(cy).toFixed(6)} ${clamp(nw).toFixed(6)} ${clamp(nh).toFixed(6)}`;
    })
    .join('\n');
}

const jobs = [];
for (const splitName of ['train', 'val']) {
  for (const item of [...pos[splitName], ...neg[splitName]]) {
    jobs.push({ splitName, item });
  }
}

let done = 0;
let failed = 0;
async function worker() {
  while (jobs.length) {
    const job = jobs.pop();
    if (!job) return;
    const { splitName, item } = job;
    const name = `${item.img.id}.jpg`;
    const url = item.img.flickr_640_url || item.img.flickr_url;
    try {
      const { buf, w, h } = await fetchImage(url);
      writeFileSync(path.join(root, 'images', splitName, name), buf);
      const lines = yoloLines(item.cans, item.img.width, item.img.height, w, h);
      writeFileSync(
        path.join(root, 'labels', splitName, name.replace('.jpg', '.txt')),
        lines ? `${lines}\n` : '',
      );
      done += 1;
    } catch (err) {
      failed += 1;
      console.error('fail', item.img.file_name, err instanceof Error ? err.message : err);
    }
    if ((done + failed) % 25 === 0) {
      console.log(`progress ${done} ok, ${failed} failed, ${jobs.length} left`);
    }
  }
}

await Promise.all(Array.from({ length: 8 }, () => worker()));
console.log(
  JSON.stringify({
    done,
    failed,
    pos: positives.length,
    neg: pickedNeg.length,
    train: pos.train.length + neg.train.length,
    val: pos.val.length + neg.val.length,
  }),
);
writeFileSync(
  path.join(root, 'data.yaml'),
  `path: ${root}\ntrain: images/train\nval: images/val\nnames:\n  0: can\n`,
);
