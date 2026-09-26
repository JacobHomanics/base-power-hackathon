export type CanBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
};

export type PhotoAnalysis = {
  status: 'scored' | 'skipped';
  tone: 'can' | 'clear' | 'muted';
  label: string;
  detail: string;
  percent: number | null;
  boxes: CanBox[];
};

export type PrepareListener = {
  onProgress?: (loaded: number, total: number) => void;
  onStarting?: () => void;
};
