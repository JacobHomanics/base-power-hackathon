export const detectorSupported: boolean = true;

export type { PhotoAnalysis, PrepareListener } from '@/detector/types';
export { analyzePhoto } from '@/detector/analyze';
export { modelIsCached, prepareModel, readyBackend } from '@/detector/session';
