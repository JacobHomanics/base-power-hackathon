/**
 * Open-vocabulary check for an aluminum can.
 *
 * OWL-ViT runs in the browser. The Transformers.js package is loaded from a
 * CDN so Metro does not have to bundle its WASM runtime. The copy of the
 * runtime shipped with Transformers.js only includes the WebGPU build, so the
 * WASM files are loaded from onnxruntime-web instead.
 */

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm';
const WASM_PATHS =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/';
const MODEL_ID = 'Xenova/owlvit-base-patch32';

const CAN_LABELS = ['aluminum can', 'soda can'];

/** OWL-ViT scores are low even on clear matches, so this stays near the library default. */
const SCORE_THRESHOLD = 0.1;
const MIN_BOX_AREA = 0.015;
const OVERLAP_THRESHOLD = 0.5;

export type CanHit = {
  score: number;
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

export type DetectorProgress = {
  percent: number | null;
};

type RawBox = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

type RawHit = {
  score: number;
  label: string;
  box: RawBox;
};

type Detector = (
  image: HTMLCanvasElement,
  labels: string[],
  options?: { threshold?: number; top_k?: number },
) => Promise<RawHit[]>;

type ProgressUpdate = {
  status?: string;
  file?: string;
  progress?: number;
};

type WasmBackend = {
  numThreads: number;
  wasmPaths?: string;
  proxy: boolean;
};

type TransformersModule = {
  pipeline: (
    task: 'zero-shot-object-detection',
    model: string,
    options?: {
      device?: 'wasm';
      dtype?: 'q8';
      progress_callback?: (update: ProgressUpdate) => void;
    },
  ) => Promise<Detector>;
  env: {
    allowLocalModels: boolean;
    backends: {
      onnx?: {
        wasm?: WasmBackend;
      };
    };
  };
};

let detectorPromise: Promise<Detector> | null = null;
let progressListener: ((progress: DetectorProgress) => void) | null = null;
let latestProgress: DetectorProgress | null = null;

export function subscribeDetectorProgress(
  listener: (progress: DetectorProgress) => void,
): () => void {
  progressListener = listener;
  if (latestProgress) {
    listener(latestProgress);
  }
  return () => {
    if (progressListener === listener) {
      progressListener = null;
    }
  };
}

export function loadCanDetector(): Promise<void> {
  return ensureDetector().then(() => undefined);
}

export async function detectCans(canvas: HTMLCanvasElement): Promise<CanHit[]> {
  const detector = await ensureDetector();
  const hits = await detector(canvas, CAN_LABELS, {
    threshold: SCORE_THRESHOLD,
    top_k: 8,
  });
  return selectCans(hits, canvas.width, canvas.height);
}

function ensureDetector(): Promise<Detector> {
  if (!detectorPromise) {
    detectorPromise = createDetector().catch((error: unknown) => {
      detectorPromise = null;
      throw error;
    });
  }
  return detectorPromise;
}

async function createDetector(): Promise<Detector> {
  const transformers = await importEsm<TransformersModule>(TRANSFORMERS_URL);
  const wasm = transformers.env.backends.onnx?.wasm;
  if (!wasm) {
    throw new Error('The detector runtime did not start.');
  }

  transformers.env.allowLocalModels = false;
  wasm.numThreads = 1;
  wasm.proxy = false;
  wasm.wasmPaths = WASM_PATHS;

  return transformers.pipeline('zero-shot-object-detection', MODEL_ID, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (update) => {
      if (update.status !== 'progress' || !update.file?.endsWith('.onnx')) {
        return;
      }
      const percent =
        typeof update.progress === 'number' ? Math.max(0, Math.min(100, Math.round(update.progress))) : null;
      latestProgress = { percent };
      progressListener?.(latestProgress);
    },
  });
}

function importEsm<T>(url: string): Promise<T> {
  // Hide the URL from Metro so the CDN module is imported by the browser.
  const load = new Function('url', 'return import(url)') as (url: string) => Promise<T>;
  return load(url);
}

function selectCans(hits: RawHit[], width: number, height: number): CanHit[] {
  if (width <= 0 || height <= 0) {
    return [];
  }

  const normalized = hits
    .map((hit) => normalizeHit(hit, width, height))
    .filter((hit): hit is CanHit => hit !== null)
    .sort((a, b) => b.score - a.score);

  const kept: CanHit[] = [];
  for (const hit of normalized) {
    const area = (hit.xmax - hit.xmin) * (hit.ymax - hit.ymin);
    if (area < MIN_BOX_AREA) {
      continue;
    }
    if (kept.some((other) => intersectionOverUnion(hit, other) > OVERLAP_THRESHOLD)) {
      continue;
    }
    kept.push(hit);
  }
  return kept;
}

function normalizeHit(hit: RawHit, width: number, height: number): CanHit | null {
  if (!Number.isFinite(hit.score) || !hit.box) {
    return null;
  }

  const pixelSized = hit.box.xmax > 1.5 || hit.box.ymax > 1.5;
  const xmin = clamp01(pixelSized ? hit.box.xmin / width : hit.box.xmin);
  const ymin = clamp01(pixelSized ? hit.box.ymin / height : hit.box.ymin);
  const xmax = clamp01(pixelSized ? hit.box.xmax / width : hit.box.xmax);
  const ymax = clamp01(pixelSized ? hit.box.ymax / height : hit.box.ymax);
  if (xmax <= xmin || ymax <= ymin) {
    return null;
  }

  return { score: hit.score, xmin, ymin, xmax, ymax };
}

function intersectionOverUnion(a: CanHit, b: CanHit): number {
  const overlapWidth = Math.max(0, Math.min(a.xmax, b.xmax) - Math.max(a.xmin, b.xmin));
  const overlapHeight = Math.max(0, Math.min(a.ymax, b.ymax) - Math.max(a.ymin, b.ymin));
  const overlap = overlapWidth * overlapHeight;
  const area = (a.xmax - a.xmin) * (a.ymax - a.ymin) + (b.xmax - b.xmin) * (b.ymax - b.ymin) - overlap;
  if (area <= 0) {
    return 0;
  }
  return overlap / area;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
