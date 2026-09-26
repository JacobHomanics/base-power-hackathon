import { formatHourEndingRange, parseErcotTime } from '@/ercot/format';
import type {
  ErcotSnapshot,
  FuelSlice,
  OutageSnapshot,
  OutlookHour,
  PriceQuote,
  ReserveProduct,
  StorageSnapshot,
  TieFlow,
} from '@/ercot/types';

const PRICE_POINTS = [
  { id: 'hbHubAvg', group: 'Hubs', label: 'Hub average', key: 'hbHubAvg' },
  { id: 'hbHouston', group: 'Hubs', label: 'Houston', key: 'hbHouston' },
  { id: 'hbNorth', group: 'Hubs', label: 'North', key: 'hbNorth' },
  { id: 'hbSouth', group: 'Hubs', label: 'South', key: 'hbSouth' },
  { id: 'hbWest', group: 'Hubs', label: 'West', key: 'hbWest' },
  { id: 'hbPan', group: 'Hubs', label: 'Panhandle', key: 'hbPan' },
  { id: 'lzHouston', group: 'Load zones', label: 'Houston', key: 'lzHouston' },
  { id: 'lzNorth', group: 'Load zones', label: 'North', key: 'lzNorth' },
  { id: 'lzSouth', group: 'Load zones', label: 'South', key: 'lzSouth' },
  { id: 'lzWest', group: 'Load zones', label: 'West', key: 'lzWest' },
] as const;

const TIES = [
  { key: 'dcE', name: 'East' },
  { key: 'dcN', name: 'North' },
  { key: 'dcL', name: 'Laredo' },
  { key: 'dcR', name: 'Railroad' },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord);
}

function epochOf(row: Record<string, unknown>): number {
  return numberValue(row.epoch) ?? numberValue(row.interval) ?? -Infinity;
}

function byEpoch(left: Record<string, unknown>, right: Record<string, unknown>): number {
  return epochOf(left) - epochOf(right);
}

function downsample(values: number[], count: number): number[] {
  if (values.length <= count) {
    return values;
  }

  const step = (values.length - 1) / (count - 1);
  const sampled: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = values[Math.round(index * step)];
    if (value !== undefined) {
      sampled.push(value);
    }
  }
  return sampled;
}

function pairMap(group: unknown): Record<string, number> {
  const mapped: Record<string, number> = {};
  if (!Array.isArray(group)) {
    return mapped;
  }

  for (const row of group) {
    if (!Array.isArray(row) || row.length < 2 || typeof row[0] !== 'string') {
      continue;
    }
    const value = numberValue(row[1]);
    if (row[0] !== 'key' && value !== null) {
      mapped[row[0]] = value;
    }
  }

  return mapped;
}

function sumValues(map: Record<string, number>, skip: string[] = []): number {
  return Object.entries(map).reduce((sum, [key, value]) => {
    return skip.includes(key) ? sum : sum + value;
  }, 0);
}

function latestUpdated(feeds: Record<string, unknown>): Date {
  let latest = new Date(0);
  for (const feed of Object.values(feeds)) {
    if (!isRecord(feed) || typeof feed.lastUpdated !== 'string') {
      continue;
    }
    const parsed = parseErcotTime(feed.lastUpdated);
    if (parsed && parsed > latest) {
      latest = parsed;
    }
  }
  return latest.getTime() === 0 ? new Date() : latest;
}

function parseDemand(raw: unknown): {
  demandMegawatts: number;
  capacityMegawatts: number;
  demandSeries: number[];
  tightestHour: OutlookHour | null;
  peakForecast: OutlookHour | null;
} | null {
  if (!isRecord(raw)) {
    return null;
  }

  const actual = rows(raw.data)
    .filter((row) => numberValue(row.forecast) === 0)
    .sort(byEpoch);
  const latest = actual[actual.length - 1];
  const demandMegawatts = latest ? numberValue(latest.demand) : null;
  const capacityMegawatts = latest ? numberValue(latest.capacity) : null;
  if (!latest || demandMegawatts === null || capacityMegawatts === null) {
    return null;
  }

  const demandSeries = actual
    .map((row) => numberValue(row.demand))
    .filter((value): value is number => value !== null);

  let tightestHour: OutlookHour | null = null;
  let peakForecast: OutlookHour | null = null;
  for (const row of rows(raw.forecast).sort(byEpoch)) {
    const demand = numberValue(row.forecastedDemand);
    const capacity = numberValue(row.availCapGen);
    if (demand === null || capacity === null || typeof row.timestamp !== 'string') {
      continue;
    }

    const hour: OutlookHour = {
      label: formatHourEndingRange(row.timestamp),
      demandMegawatts: demand,
      capacityMegawatts: capacity,
      marginMegawatts: capacity - demand,
    };

    if (!tightestHour || hour.marginMegawatts < tightestHour.marginMegawatts) {
      tightestHour = hour;
    }
    if (!peakForecast || hour.demandMegawatts > peakForecast.demandMegawatts) {
      peakForecast = hour;
    }
  }

  return {
    demandMegawatts,
    capacityMegawatts,
    demandSeries,
    tightestHour,
    peakForecast,
  };
}

function parseFuels(raw: unknown): FuelSlice[] | null {
  if (!isRecord(raw) || !isRecord(raw.data)) {
    return null;
  }

  const dates = Object.keys(raw.data).sort();
  const latestDate = dates[dates.length - 1];
  const day = latestDate ? raw.data[latestDate] : null;
  if (!isRecord(day)) {
    return null;
  }

  let latestMs = -Infinity;
  let latestMix: Record<string, unknown> | null = null;
  for (const [timestamp, mix] of Object.entries(day)) {
    const parsed = parseErcotTime(timestamp);
    if (!parsed || !isRecord(mix) || parsed.getTime() < latestMs) {
      continue;
    }
    latestMs = parsed.getTime();
    latestMix = mix;
  }

  if (!latestMix) {
    return null;
  }

  const capacity = isRecord(raw.monthlyCapacity) ? raw.monthlyCapacity : {};
  const fuels = Object.entries(latestMix).flatMap(([name, value]) => {
    const megawatts = isRecord(value) ? numberValue(value.gen) : numberValue(value);
    if (megawatts === null) {
      return [];
    }
    return [
      {
        name,
        megawatts,
        capacityMegawatts: numberValue(capacity[name]),
      },
    ];
  });

  return fuels.length > 0 ? fuels : null;
}

function parseCondition(raw: unknown): {
  conditionTitle: string;
  conditionNote: string;
  conditionState: string;
  eeaLevel: number;
  prcMegawatts: number;
  prcSeries: number[];
} | null {
  if (!isRecord(raw) || !isRecord(raw.current_condition)) {
    return null;
  }

  const current = raw.current_condition;
  const prcMegawatts = numberValue(current.prc_value);
  if (prcMegawatts === null || typeof current.title !== 'string') {
    return null;
  }

  const prcSeries = downsample(
    rows(raw.data)
      .sort(byEpoch)
      .map((row) => numberValue(row.prc))
      .filter((value): value is number => value !== null),
    96,
  );

  return {
    conditionTitle: current.title,
    conditionNote:
      typeof current.condition_note === 'string' ? current.condition_note : '',
    conditionState: typeof current.state === 'string' ? current.state : 'unknown',
    eeaLevel: numberValue(current.eea_level) ?? 0,
    prcMegawatts,
    prcSeries,
  };
}

function parsePrices(raw: unknown): { prices: PriceQuote[]; hubAverageSeries: number[] } {
  if (!isRecord(raw)) {
    return { prices: [], hubAverageSeries: [] };
  }

  const realtimeRows = rows(raw.rtSppData).sort(byEpoch);
  const latest = realtimeRows[realtimeRows.length - 1];
  const dayAheadRows = rows(raw.damSppData);
  const realtimeEpoch = latest ? epochOf(latest) : null;
  const hourEnding =
    realtimeEpoch !== null && Number.isFinite(realtimeEpoch)
      ? realtimeEpoch % 3_600_000 === 0
        ? realtimeEpoch
        : Math.ceil(realtimeEpoch / 3_600_000) * 3_600_000
      : null;
  const dayAhead =
    hourEnding === null
      ? null
      : (dayAheadRows.find((row) => epochOf(row) === hourEnding) ?? null);

  const prices = PRICE_POINTS.map((point) => ({
    id: point.id,
    group: point.group,
    label: point.label,
    realtime: latest ? numberValue(latest[point.key]) : null,
    dayAhead: dayAhead ? numberValue(dayAhead[point.key]) : null,
  }));

  const hubAverageSeries = realtimeRows
    .map((row) => numberValue(row.hbHubAvg))
    .filter((value): value is number => value !== null);

  return { prices, hubAverageSeries };
}

function parseStorage(raw: unknown, fuels: FuelSlice[]): StorageSnapshot | null {
  if (!isRecord(raw) || !isRecord(raw.currentDay)) {
    return null;
  }

  const series = rows(raw.currentDay.data).sort(byEpoch);
  const latest = series[series.length - 1];
  if (!latest) {
    return null;
  }

  const charging = numberValue(latest.totalCharging);
  const discharging = numberValue(latest.totalDischarging);
  const net = numberValue(latest.netOutput);
  if (charging === null || discharging === null || net === null) {
    return null;
  }

  const capacity = fuels.find((fuel) => fuel.name === 'Power Storage')?.capacityMegawatts ?? null;

  return {
    chargingMegawatts: Math.abs(charging),
    dischargingMegawatts: discharging,
    netMegawatts: net,
    capacityMegawatts: capacity,
    netSeries: series
      .map((row) => numberValue(row.netOutput))
      .filter((value): value is number => value !== null),
  };
}

function nestedMegawatts(value: unknown, key: string): number | null {
  if (!isRecord(value)) {
    return null;
  }
  return numberValue(value[key]);
}

function parseOutages(raw: unknown): OutageSnapshot | null {
  if (!isRecord(raw) || !isRecord(raw.current)) {
    return null;
  }

  const keys = Object.keys(raw.current);
  const lastKey = keys.reduce<string | null>((best, key) => {
    if (best === null || Number(key) > Number(best)) {
      return key;
    }
    return best;
  }, null);
  const latest = lastKey ? raw.current[lastKey] : null;
  if (!isRecord(latest)) {
    return null;
  }

  const total = nestedMegawatts(latest.Combined, 'total');
  const planned = nestedMegawatts(latest.Combined, 'planned');
  const unplanned = nestedMegawatts(latest.Combined, 'unplanned');
  const dispatchable = nestedMegawatts(latest.Dispatchable, 'total');
  const renewable = nestedMegawatts(latest.Renewable, 'total');
  if (
    total === null ||
    planned === null ||
    unplanned === null ||
    dispatchable === null ||
    renewable === null
  ) {
    return null;
  }

  return {
    totalMegawatts: total,
    plannedMegawatts: planned,
    unplannedMegawatts: unplanned,
    dispatchableMegawatts: dispatchable,
    renewableMegawatts: renewable,
  };
}

function parseTies(raw: unknown): {
  ties: TieFlow[];
  frequencyHertz: number | null;
  inertiaMegawattSeconds: number | null;
} {
  if (!isRecord(raw)) {
    return { ties: [], frequencyHertz: null, inertiaMegawattSeconds: null };
  }

  const latest = rows(raw.data).sort(byEpoch).at(-1);
  if (!latest) {
    return { ties: [], frequencyHertz: null, inertiaMegawattSeconds: null };
  }

  const ties = TIES.flatMap((tie) => {
    const megawatts = numberValue(latest[tie.key]);
    return megawatts === null ? [] : [{ name: tie.name, megawatts }];
  });

  const frequency = numberValue(latest.currentFrequency);
  const inertia = numberValue(latest.currentSystemInertia);

  return {
    ties,
    frequencyHertz: frequency !== null && frequency > 50 && frequency < 70 ? frequency : null,
    inertiaMegawattSeconds: inertia !== null && inertia > 0 ? inertia : null,
  };
}

function parseReserves(raw: unknown): ReserveProduct[] {
  if (!isRecord(raw) || !isRecord(raw.data)) {
    return [];
  }

  const regulation = pairMap(raw.data.regulationCapacityGroup);
  const responsive = pairMap(raw.data.responsiveReserveCapabilityGroup);
  const contingency = pairMap(raw.data.ercotContingencyReserveCapabilityGroup);
  const nonSpin = pairMap(raw.data.nonSpinReserveCapabilityGroup);
  const products: ReserveProduct[] = [];

  if (regulation.regUpCap !== undefined) {
    products.push({
      name: 'Regulation up',
      capacityMegawatts: regulation.regUpCap,
      deployedMegawatts: regulation.regUpDeployed ?? null,
    });
  }
  if (regulation.regDownCap !== undefined) {
    products.push({
      name: 'Regulation down',
      capacityMegawatts: regulation.regDownCap,
      deployedMegawatts: regulation.regDownDeployed ?? null,
    });
  }
  if (Object.keys(responsive).length > 0) {
    products.push({
      name: 'Responsive reserve',
      capacityMegawatts: sumValues(responsive),
      deployedMegawatts: null,
    });
  }
  if (Object.keys(contingency).length > 0) {
    products.push({
      name: 'Contingency reserve',
      capacityMegawatts: sumValues(contingency, ['ecrsCapDeployedGenLr']),
      deployedMegawatts: contingency.ecrsCapDeployedGenLr ?? null,
    });
  }
  if (Object.keys(nonSpin).length > 0) {
    products.push({
      name: 'Non-spin',
      capacityMegawatts: sumValues(nonSpin),
      deployedMegawatts: null,
    });
  }

  return products;
}

export function parseErcotSnapshot(feeds: Record<string, unknown>): ErcotSnapshot {
  const demand = parseDemand(feeds['supply-demand.json']);
  const fuels = parseFuels(feeds['fuel-mix.json']);
  const condition = parseCondition(feeds['daily-prc.json']);

  if (!demand || !fuels || !condition) {
    throw new Error('ERCOT returned an incomplete snapshot.');
  }

  const { prices, hubAverageSeries } = parsePrices(feeds['system-wide-prices.json']);
  const system = parseTies(feeds['dc-tie-flows.json']);

  return {
    updatedAt: latestUpdated(feeds),
    ...condition,
    ...demand,
    headroomMegawatts: demand.capacityMegawatts - demand.demandMegawatts,
    frequencyHertz: system.frequencyHertz,
    inertiaMegawattSeconds: system.inertiaMegawattSeconds,
    fuels,
    prices,
    hubAverageSeries,
    storage: parseStorage(feeds['energy-storage-resources.json'], fuels),
    outages: parseOutages(feeds['generation-outages.json']),
    ties: system.ties,
    reserves: parseReserves(feeds['ancillary-service-capacity-monitor.json']),
  };
}
