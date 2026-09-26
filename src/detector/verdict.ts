import manifest from '@/detector/manifest.json';
import type { PhotoAnalysis } from '@/detector/types';

export function calibrate(logit: number): number {
  const z = logit / manifest.temperature + manifest.bias;
  return 1 / (1 + Math.exp(-z));
}

export function degradationNote(block: number, d12: number): string | null {
  const heavyJpeg = block >= 1.8;
  const upscaled = d12 < 0.528;
  if (heavyJpeg && upscaled) return 'heavily recompressed and upscaled';
  if (heavyJpeg) return 'heavily recompressed';
  if (upscaled) return 'upscaled past its original detail';
  return null;
}

function percentOf(score: number): number {
  return Math.round(score * 100);
}

export function scoredVerdict(input: {
  score: number;
  degraded: boolean;
  note: string | null;
  width: number;
  height: number;
  backend: string;
  milliseconds: number;
  secondView: boolean;
}): PhotoAnalysis {
  const percent = percentOf(input.score);
  const flagged = input.score >= manifest.threshold && !input.degraded;
  const unsure =
    !flagged && (input.score >= 0.5 || (input.score >= manifest.threshold && input.degraded));
  const tone = flagged ? 'ai' : unsure ? 'unsure' : 'real';
  const label = flagged ? 'Likely AI-generated' : unsure ? 'Unsure' : 'Likely a real photo';
  const threshold = Math.round(manifest.threshold * 100);
  let detail = `AI confidence is ${percent}%.`;
  if (flagged && input.score < manifest.threshold + 0.1) {
    detail = `AI confidence is ${percent}%, just above the ${threshold}% line. Scores this close to the line are wrong more often.`;
  } else if (unsure && input.degraded && input.note) {
    detail = `AI confidence is ${percent}%. The file looks ${input.note}, so this is not a firm verdict.`;
  } else if (unsure) {
    detail = `AI confidence is ${percent}%, below the ${threshold}% line used to flag an image.`;
  } else if (!flagged) {
    detail = `AI confidence is ${percent}%, which reads as a real photo.`;
  }

  return {
    status: 'scored',
    tone,
    label,
    detail,
    meta: `${input.width} × ${input.height} · ${input.backend} · ${input.milliseconds} ms`,
    percent,
    secondView: input.secondView,
  };
}

export function metadataVerdict(reason: string, detail: string): PhotoAnalysis {
  return {
    status: 'scored',
    tone: 'ai',
    label: 'Likely AI-generated',
    detail,
    meta: `From file metadata · ${reason}`,
    percent: 99,
    secondView: false,
  };
}

export function skippedVerdict(
  reason: 'too-small' | 'flat' | 'noise',
  width: number,
  height: number,
): PhotoAnalysis {
  const detail =
    reason === 'too-small'
      ? 'This image is under 32 pixels on its shorter side, which is too little detail to score.'
      : reason === 'flat'
        ? 'This image is a flat color, so there is nothing to analyze.'
        : 'This image looks like random noise, so there is nothing to analyze.';
  return {
    status: 'skipped',
    tone: 'muted',
    label: 'Not analyzed',
    detail,
    meta: `${width} × ${height}`,
    percent: null,
    secondView: false,
  };
}
