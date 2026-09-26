export type FuelSlice = {
  name: string;
  megawatts: number;
  capacityMegawatts: number | null;
};

export type PriceGroup = 'Hubs' | 'Load zones';

export type PriceQuote = {
  id: string;
  group: PriceGroup;
  label: string;
  realtime: number | null;
  dayAhead: number | null;
};

export type StorageSnapshot = {
  chargingMegawatts: number;
  dischargingMegawatts: number;
  netMegawatts: number;
  capacityMegawatts: number | null;
  netSeries: number[];
};

export type OutageSnapshot = {
  totalMegawatts: number;
  plannedMegawatts: number;
  unplannedMegawatts: number;
  dispatchableMegawatts: number;
  renewableMegawatts: number;
};

export type TieFlow = {
  name: string;
  megawatts: number;
};

export type ReserveProduct = {
  name: string;
  capacityMegawatts: number;
  deployedMegawatts: number | null;
};

export type OutlookHour = {
  label: string;
  demandMegawatts: number;
  capacityMegawatts: number;
  marginMegawatts: number;
};

export type ErcotSnapshot = {
  updatedAt: Date;
  conditionTitle: string;
  conditionNote: string;
  conditionState: string;
  eeaLevel: number;
  demandMegawatts: number;
  capacityMegawatts: number;
  headroomMegawatts: number;
  demandSeries: number[];
  prcMegawatts: number;
  prcSeries: number[];
  frequencyHertz: number | null;
  inertiaMegawattSeconds: number | null;
  fuels: FuelSlice[];
  prices: PriceQuote[];
  hubAverageSeries: number[];
  storage: StorageSnapshot | null;
  outages: OutageSnapshot | null;
  ties: TieFlow[];
  reserves: ReserveProduct[];
  tightestHour: OutlookHour | null;
  peakForecast: OutlookHour | null;
};
