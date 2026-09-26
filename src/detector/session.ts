// On-device session for the can detector. Weights load from this site, then stay
// in origin-private storage.

import manifest from '@/detector/manifest.json';
import type { PrepareListener } from '@/detector/types';

const MODEL_FILE = 'can-model.onnx';
const META_FILE = 'can-model-meta.json';
const PUBLIC_MODEL_PATH = `/model/${manifest.filename}`;
const ORT_SCRIPT = '/ort/ort.webgpu.min.js';

type CacheMeta = {
  sha256: string;
  version: string;
  wasmFingerprint?: number;
};

type OrtTensor = {
  data?: ArrayLike<number>;
  dims?: readonly number[];
  location?: string;
  getData?: () => Promise<ArrayLike<number>>;
};

type OrtSession = {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run: (feeds: Record<string, unknown>) => Promise<Record<string, OrtTensor>>;
  release?: () => Promise<void>;
};

type OrtApi = {
  env: {
    wasm: {
      wasmPaths?: string;
      numThreads?: number;
    };
  };
  InferenceSession: {
    create: (
      buffer: ArrayBuffer,
      options: { executionProviders: string[]; graphOptimizationLevel: 'all' },
    ) => Promise<OrtSession>;
  };
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => unknown;
};

type ReadySession = {
  session: OrtSession;
  backend: string;
  ort: OrtApi;
};

export type DetectionOutput = {
  data: Float32Array;
  dims: readonly number[];
  backend: string;
};

let memoryBytes: ArrayBuffer | null = null;
let ready: ReadySession | null = null;
let inflight: Promise<ReadySession> | null = null;
let chain: Promise<unknown> = Promise.resolve();

export function readyBackend(): string | null {
  return ready?.backend ?? null;
}

function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };
  if (!storage.getDirectory) return Promise.resolve(null);
  return storage.getDirectory().catch(() => null);
}

async function readMeta(): Promise<CacheMeta | null> {
  const root = await opfsRoot();
  if (!root) return null;
  try {
    const handle = await root.getFileHandle(META_FILE);
    const file = await handle.getFile();
    return JSON.parse(await file.text()) as CacheMeta;
  } catch {
    return null;
  }
}

async function writeMeta(meta: CacheMeta): Promise<void> {
  const root = await opfsRoot();
  if (!root) return;
  const handle = await root.getFileHandle(META_FILE, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(meta));
  await writable.close();
}

async function readCachedBytes(): Promise<ArrayBuffer | null> {
  const meta = await readMeta();
  if (!meta || meta.sha256 !== manifest.sha256 || meta.version !== manifest.version) return null;
  const root = await opfsRoot();
  if (!root) return null;
  try {
    const handle = await root.getFileHandle(MODEL_FILE);
    const file = await handle.getFile();
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

async function cacheBytes(bytes: ArrayBuffer, meta: CacheMeta): Promise<void> {
  const root = await opfsRoot();
  if (!root) return;
  const handle = await root.getFileHandle(MODEL_FILE, { create: true });
  const writable = await handle.createWritable();
  await writable.write(bytes);
  await writable.close();
  await writeMeta(meta);
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function downloadModel(listener?: PrepareListener): Promise<ArrayBuffer> {
  const response = await fetch(PUBLIC_MODEL_PATH);
  if (!response.ok) {
    throw new Error(
      `The model file isn't available (${response.status}). From the project folder, run node scripts/prepare-detector.mjs and reload.`,
    );
  }
  const total = Number(response.headers.get('content-length')) || manifest.bytes;
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The model download returned an empty response.');
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.byteLength;
    listener?.onProgress?.(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const hash = await sha256(out.buffer);
  if (hash !== manifest.sha256) {
    throw new Error("The model file doesn't match the pinned checksum.");
  }
  return out.buffer;
}

async function loadModelBytes(listener?: PrepareListener): Promise<ArrayBuffer> {
  if (memoryBytes) return memoryBytes;
  const cached = await readCachedBytes();
  if (cached) {
    memoryBytes = cached;
    return cached;
  }
  const downloaded = await downloadModel(listener);
  memoryBytes = downloaded;
  await cacheBytes(downloaded, { sha256: manifest.sha256, version: manifest.version }).catch(
    () => undefined,
  );
  return downloaded;
}

export async function modelIsCached(): Promise<boolean> {
  if (memoryBytes) return true;
  const meta = await readMeta();
  if (!meta || meta.sha256 !== manifest.sha256 || meta.version !== manifest.version) return false;
  const root = await opfsRoot();
  if (!root) return false;
  try {
    await root.getFileHandle(MODEL_FILE);
    return true;
  } catch {
    return false;
  }
}

function loadOrt(): Promise<OrtApi> {
  const existing = (window as Window & { ort?: OrtApi }).ort;
  if (existing) return Promise.resolve(configureOrt(existing));
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = ORT_SCRIPT;
    script.async = true;
    script.onload = () => {
      const ort = (window as Window & { ort?: OrtApi }).ort;
      if (!ort) {
        reject(new Error('The detector runtime loaded without a global.'));
        return;
      }
      resolve(configureOrt(ort));
    };
    script.onerror = () => reject(new Error('The detector runtime failed to load.'));
    document.head.appendChild(script);
  });
}

function configureOrt(ort: OrtApi): OrtApi {
  ort.env.wasm.wasmPaths = new URL('/ort/', window.location.href).toString();
  ort.env.wasm.numThreads = 1;
  return ort;
}

async function hasHardwareGpu(): Promise<boolean> {
  const gpu = (
    navigator as Navigator & {
      gpu?: { requestAdapter: () => Promise<{ isFallbackAdapter?: boolean } | null> };
    }
  ).gpu;
  try {
    const adapter = (await gpu?.requestAdapter()) as { isFallbackAdapter?: boolean } | null | undefined;
    return !!adapter && !adapter.isFallbackAdapter;
  } catch {
    return false;
  }
}

function probeTensor(ort: OrtApi) {
  const size = manifest.inputSize;
  const n = 3 * size * size;
  const out = new Float32Array(n);
  let state = 0x5eed1234 >>> 0;
  for (let i = 0; i < n; i += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out[i] = state / 4294967296;
  }
  return new ort.Tensor('float32', out, [1, 3, size, size]);
}

function fingerprint(data: Float32Array): number {
  let hash = 2166136261;
  for (let i = 0; i < data.length; i += 17) {
    hash ^= Math.round(data[i]) + i;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function tensorFloats(output: OrtTensor | undefined): Promise<{ data: Float32Array; dims: readonly number[] }> {
  if (!output) throw new Error('The model returned no detections.');
  const dims = output.dims ?? [];
  try {
    if (output.data && (output.location === undefined || output.location === 'cpu')) {
      const data = output.data instanceof Float32Array ? output.data : Float32Array.from(output.data);
      return { data, dims };
    }
  } catch {
    // WebGPU can keep the tensor off-CPU until getData().
  }
  if (!output.getData) throw new Error('The model returned an unreadable detection.');
  const raw = await output.getData();
  const data = raw instanceof Float32Array ? raw : Float32Array.from(raw);
  return { data, dims };
}

async function runSession(session: OrtSession, tensor: unknown): Promise<{ data: Float32Array; dims: readonly number[] }> {
  const result = await session.run({ [session.inputNames[0] ?? 'images']: tensor });
  return tensorFloats(result[session.outputNames[0] ?? '']);
}

async function openSession(ort: OrtApi, bytes: ArrayBuffer): Promise<{ session: OrtSession; backend: string }> {
  const wasmSession = () =>
    ort.InferenceSession.create(bytes.slice(0), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

  try {
    if (!(await hasHardwareGpu())) throw new Error('no-webgpu');
    const gpu = await ort.InferenceSession.create(bytes.slice(0), {
      executionProviders: ['webgpu'],
      graphOptimizationLevel: 'all',
    });
    const probe = probeTensor(ort);
    const gpuOut = await runSession(gpu, probe);
    const meta = (await readMeta()) ?? { sha256: manifest.sha256, version: manifest.version };
    let ref = meta.wasmFingerprint;
    let wasmHeld: OrtSession | null = null;
    if (typeof ref !== 'number') {
      wasmHeld = await wasmSession();
      ref = fingerprint((await runSession(wasmHeld, probe)).data);
      meta.wasmFingerprint = ref;
      writeMeta(meta).catch(() => undefined);
    }
    if (fingerprint(gpuOut.data) !== ref) {
      const session = wasmHeld ?? (await wasmSession());
      return { session, backend: 'WASM' };
    }
    await wasmHeld?.release?.().catch(() => undefined);
    return { session: gpu, backend: 'WebGPU' };
  } catch (gpuError) {
    try {
      return { session: await wasmSession(), backend: 'WASM' };
    } catch (wasmError) {
      const detail = wasmError instanceof Error ? wasmError.message : String(wasmError);
      const reason = gpuError instanceof Error ? gpuError.message : '';
      throw new Error(
        `The detector runtime failed to start. ${detail}${reason ? ` (${reason})` : ''}`,
      );
    }
  }
}

async function createSession(listener?: PrepareListener): Promise<ReadySession> {
  const [ort, bytes] = await Promise.all([loadOrt(), loadModelBytes(listener)]);
  listener?.onStarting?.();
  const opened = await openSession(ort, bytes);
  return { ...opened, ort };
}

export function prepareModel(listener?: PrepareListener): Promise<{ backend: string }> {
  if (ready) return Promise.resolve({ backend: ready.backend });
  if (!inflight) {
    inflight = createSession(listener).then(
      (value) => {
        ready = value;
        return value;
      },
      (error: unknown) => {
        inflight = null;
        throw error;
      },
    );
  }
  return inflight.then(({ backend }) => ({ backend }));
}

export function detectTensor(data: Float32Array): Promise<DetectionOutput> {
  const task = async () => {
    const current = await prepareModel();
    const active = ready;
    if (!active) throw new Error('The model is not ready.');
    const size = manifest.inputSize;
    const tensor = new active.ort.Tensor('float32', data, [1, 3, size, size]);
    const output = await runSession(active.session, tensor);
    return { ...output, backend: current.backend };
  };
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
