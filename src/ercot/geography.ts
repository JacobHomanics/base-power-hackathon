export type MapLatLng = {
  lat: number;
  lng: number;
};

export type MapRegionKind = 'zone' | 'hub';

export type MapRegionView = {
  id: string;
  name: string;
  kind: MapRegionKind;
  realtime: number | null;
  dayAhead: number | null;
  hubRealtime: number | null;
  hubDayAhead: number | null;
  note: string | null;
};

export type MapTieView = {
  name: string;
  megawatts: number;
};

type RegionPlace = {
  label: MapLatLng;
  path: MapLatLng[] | null;
};

type TiePlace = {
  title: string;
  detail: string;
  position: MapLatLng;
};

const MAP_PRICE_NEUTRAL = '#8b95a8';

/**
 * Schematic load-zone shapes for the map. They follow the familiar ERCOT
 * split — West, North, South, Houston — and leave out El Paso and Amarillo,
 * which are outside ERCOT. They are not the official boundary file.
 */
export const REGION_PLACES: Record<string, RegionPlace> = {
  lzWest: {
    label: { lat: 31.85, lng: -101.7 },
    path: [
      { lat: 33.7, lng: -102.4 },
      { lat: 33.55, lng: -99.9 },
      { lat: 32.45, lng: -99.75 },
      { lat: 31.2, lng: -99.9 },
      { lat: 29.85, lng: -100.9 },
      { lat: 29.4, lng: -100.95 },
      { lat: 29.85, lng: -102.45 },
      { lat: 31.05, lng: -103.05 },
      { lat: 32.75, lng: -103.05 },
      { lat: 33.6, lng: -102.9 },
    ],
  },
  lzNorth: {
    label: { lat: 32.45, lng: -97.15 },
    path: [
      { lat: 33.55, lng: -99.9 },
      { lat: 33.75, lng: -94.25 },
      { lat: 32.05, lng: -94.1 },
      { lat: 30.85, lng: -95.4 },
      { lat: 30.7, lng: -96.4 },
      { lat: 31.05, lng: -97.4 },
      { lat: 31.2, lng: -99.9 },
      { lat: 32.45, lng: -99.75 },
    ],
  },
  lzHouston: {
    label: { lat: 29.76, lng: -95.2 },
    path: [
      { lat: 30.85, lng: -95.4 },
      { lat: 30.55, lng: -94.05 },
      { lat: 29.7, lng: -93.85 },
      { lat: 29.0, lng: -95.15 },
      { lat: 29.05, lng: -96.2 },
      { lat: 29.8, lng: -96.55 },
      { lat: 30.7, lng: -96.4 },
    ],
  },
  lzSouth: {
    label: { lat: 28.85, lng: -98.35 },
    path: [
      { lat: 31.2, lng: -99.9 },
      { lat: 31.05, lng: -97.4 },
      { lat: 30.7, lng: -96.4 },
      { lat: 29.8, lng: -96.55 },
      { lat: 29.05, lng: -96.2 },
      { lat: 28.15, lng: -96.55 },
      { lat: 27.15, lng: -97.4 },
      { lat: 25.9, lng: -97.15 },
      { lat: 26.05, lng: -98.55 },
      { lat: 27.55, lng: -99.55 },
      { lat: 29.4, lng: -100.95 },
      { lat: 29.85, lng: -100.9 },
    ],
  },
  hbPan: {
    label: { lat: 35.4, lng: -101.4 },
    path: null,
  },
};

export const TIE_PLACES: Record<string, TiePlace> = {
  North: {
    title: 'North tie',
    detail: 'Oklaunion, toward the Southwest Power Pool',
    position: { lat: 34.08, lng: -99.17 },
  },
  East: {
    title: 'East tie',
    detail: 'Monticello, toward the Eastern Interconnection',
    position: { lat: 33.09, lng: -95.04 },
  },
  Laredo: {
    title: 'Laredo tie',
    detail: 'Laredo variable-frequency transformer, toward Mexico',
    position: { lat: 27.53, lng: -99.49 },
  },
  Railroad: {
    title: 'Railroad tie',
    detail: 'McAllen, toward Mexico',
    position: { lat: 26.18, lng: -98.32 },
  },
};

export function priceRange(values: number[]): { low: number; high: number } {
  const first = values[0];
  if (first === undefined) {
    return { low: 0, high: 1 };
  }

  let low = first;
  let high = first;
  for (const value of values) {
    if (value < low) {
      low = value;
    }
    if (value > high) {
      high = value;
    }
  }

  if (high - low < 5) {
    return { low: low - 2, high: high + 2 };
  }

  return { low, high };
}

export function priceFill(value: number | null, low: number, high: number): string {
  if (value === null) {
    return MAP_PRICE_NEUTRAL;
  }

  const span = high - low || 1;
  const t = Math.min(1, Math.max(0, (value - low) / span));
  if (t < 0.5) {
    return mixHex('#2a9d8f', '#e9b308', t / 0.5);
  }
  return mixHex('#e9b308', '#c43218', (t - 0.5) / 0.5);
}

function mixHex(from: string, to: string, amount: number): string {
  const start = hexChannels(from);
  const end = hexChannels(to);
  const channels = start.map((channel, index) => {
    const target = end[index] ?? channel;
    return Math.round(channel + (target - channel) * amount);
  });
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function hexChannels(hex: string): number[] {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
}
