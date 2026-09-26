// Copies the ONNX Runtime Web files and the vendored can detector into public/
// so the browser can load them from the same origin.

import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';
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
  const source = path.join(root, 'models', manifest.filename);
  if (
    existsSync(dest) &&
    existsSync(stamp) &&
    readFileSync(stamp, 'utf8').trim() === manifest.sha256 &&
    statSync(dest).size === manifest.bytes
  ) {
    return;
  }
  if (!existsSync(source)) {
    throw new Error(`Missing ${source}. The can detector weights are vendored in models/.`);
  }
  await copyFile(source, dest);
  const hash = await sha256(dest);
  if (hash !== manifest.sha256 || statSync(dest).size !== manifest.bytes) {
    rmSync(dest, { force: true });
    throw new Error(`Model checksum mismatch: ${hash}`);
  }
  writeFileSync(stamp, `${manifest.sha256}\n`);
  console.log(`Copied ${dest}`);
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
