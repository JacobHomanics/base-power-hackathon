// Copies the ONNX Runtime Web files and the pinned Sieve model into public/
// so the browser can load them from the same origin. GitHub release assets
// do not send CORS headers, so the page cannot fetch the model directly.

import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'src/detector/manifest.json'), 'utf8'));

const ortFiles = [
  'ort.webgpu.min.js',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
];

async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function ensureModel() {
  const dir = path.join(root, 'public', 'model');
  mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, manifest.filename);
  const stamp = path.join(dir, `${manifest.filename}.sha256`);
  if (
    existsSync(dest) &&
    existsSync(stamp) &&
    readFileSync(stamp, 'utf8').trim() === manifest.sha256 &&
    statSync(dest).size === manifest.bytes
  ) {
    return;
  }

  console.log(`Downloading ${manifest.filename} (${Math.round(manifest.bytes / 1e6)} MB)…`);
  const response = await fetch(manifest.sourceUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Model download failed (${response.status}) from ${manifest.sourceUrl}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
  const hash = await sha256(dest);
  if (hash !== manifest.sha256) {
    rmSync(dest, { force: true });
    throw new Error(`Model checksum mismatch: ${hash}`);
  }
  writeFileSync(stamp, `${manifest.sha256}\n`);
  console.log(`Saved ${dest}`);
}

async function ensureRuntime() {
  const srcDir = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
  const destDir = path.join(root, 'public', 'ort');
  if (!existsSync(srcDir)) {
    throw new Error('onnxruntime-web is not installed. Run pnpm install.');
  }
  mkdirSync(destDir, { recursive: true });
  for (const file of ortFiles) {
    await copyFile(path.join(srcDir, file), path.join(destDir, file));
  }
}

await ensureRuntime();
await ensureModel();
