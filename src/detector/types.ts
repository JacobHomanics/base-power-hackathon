export type PhotoAnalysis = {
  status: 'scored' | 'skipped';
  tone: 'ai' | 'unsure' | 'real' | 'muted';
  label: string;
  detail: string;
  meta: string | null;
  percent: number | null;
  secondView: boolean;
};

export type PrepareListener = {
  onProgress?: (loaded: number, total: number) => void;
  onStarting?: () => void;
};
