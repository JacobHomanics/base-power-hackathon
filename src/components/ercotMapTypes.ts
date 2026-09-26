import type { MapRegionView, MapTieView } from '@/ercot/geography';

export type ErcotMapStatus = 'ready' | 'error' | 'missing-key';

export type ErcotMapProps = {
  regions: MapRegionView[];
  ties: MapTieView[];
  isDark: boolean;
  onStatus?: (status: ErcotMapStatus) => void;
};
