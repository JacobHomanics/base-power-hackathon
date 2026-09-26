import { formatPower, formatPrice } from '@/ercot/format';
import type { ErcotSnapshot } from '@/ercot/types';

const ZONES = [
  { id: 'lzNorth', hubId: 'hbNorth', name: 'North' },
  { id: 'lzHouston', hubId: 'hbHouston', name: 'Houston' },
  { id: 'lzSouth', hubId: 'hbSouth', name: 'South' },
  { id: 'lzWest', hubId: 'hbWest', name: 'West' },
] as const;

type PricedZone = {
  name: string;
  realtime: number;
  dayAhead: number | null;
  hubRealtime: number | null;
};

export function mapInsights(snapshot: ErcotSnapshot): string[] {
  const quote = (id: string) => snapshot.prices.find((price) => price.id === id);
  const zones = ZONES.flatMap((zone): PricedZone[] => {
    const zonePrice = quote(zone.id);
    if (zonePrice?.realtime == null) {
      return [];
    }
    return [
      {
        name: zone.name,
        realtime: zonePrice.realtime,
        dayAhead: zonePrice.dayAhead,
        hubRealtime: quote(zone.hubId)?.realtime ?? null,
      },
    ];
  });

  const lines: string[] = [];
  const spread = zoneSpread(zones);
  if (spread) {
    lines.push(spread);
  }

  const dayAhead = widestDayAheadGap(zones, quote('hbPan'));
  if (dayAhead) {
    lines.push(dayAhead);
  }

  const basis = strongestBasis(zones, quote('hbPan')?.realtime ?? null, quote('hbHubAvg')?.realtime ?? null);
  if (basis && lines.length < 3) {
    lines.push(basis);
  }

  const ties = tieInsight(snapshot);
  if (ties) {
    lines.push(ties);
  }

  return lines.slice(0, 4);
}

function zoneSpread(zones: PricedZone[]): string | null {
  const first = zones[0];
  if (!first || zones.length < 2) {
    return null;
  }

  let high = first;
  let low = first;
  for (const zone of zones) {
    if (zone.realtime > high.realtime) {
      high = zone;
    }
    if (zone.realtime < low.realtime) {
      low = zone;
    }
  }

  const spread = high.realtime - low.realtime;
  if (spread < 3) {
    return `Load zone prices are within ${formatPrice(spread)} of each other.`;
  }
  return `${high.name} is the expensive zone, ${formatPrice(spread)} above ${low.name}.`;
}

function widestDayAheadGap(
  zones: PricedZone[],
  panhandle: { realtime: number | null; dayAhead: number | null } | undefined,
): string | null {
  const gaps: { name: string; delta: number }[] = [];
  for (const zone of zones) {
    if (zone.dayAhead !== null) {
      gaps.push({ name: zone.name, delta: zone.realtime - zone.dayAhead });
    }
  }
  if (panhandle?.realtime != null && panhandle.dayAhead != null) {
    gaps.push({ name: 'Panhandle', delta: panhandle.realtime - panhandle.dayAhead });
  }

  let widest: { name: string; delta: number } | null = null;
  for (const gap of gaps) {
    if (!widest || Math.abs(gap.delta) > Math.abs(widest.delta)) {
      widest = gap;
    }
  }
  if (!widest || Math.abs(widest.delta) < 5) {
    return null;
  }

  const direction = widest.delta > 0 ? 'above' : 'below';
  return `${widest.name} real-time is ${formatPrice(Math.abs(widest.delta))} ${direction} day-ahead.`;
}

function strongestBasis(
  zones: PricedZone[],
  panhandleRealtime: number | null,
  hubAverage: number | null,
): string | null {
  const candidates: { magnitude: number; text: string }[] = [];

  if (panhandleRealtime !== null && hubAverage !== null) {
    const basis = panhandleRealtime - hubAverage;
    if (Math.abs(basis) >= 3) {
      const direction = basis > 0 ? 'above' : 'below';
      candidates.push({
        magnitude: Math.abs(basis),
        text: `The Panhandle hub is ${formatPrice(Math.abs(basis))} ${direction} the system hub average.`,
      });
    }
  }

  for (const zone of zones) {
    if (zone.hubRealtime === null) {
      continue;
    }
    const gap = zone.realtime - zone.hubRealtime;
    if (Math.abs(gap) < 3) {
      continue;
    }
    const direction = gap > 0 ? 'above' : 'below';
    candidates.push({
      magnitude: Math.abs(gap),
      text: `The ${zone.name} load zone is ${formatPrice(Math.abs(gap))} ${direction} its trading hub.`,
    });
  }

  let best: { magnitude: number; text: string } | null = null;
  for (const candidate of candidates) {
    if (!best || candidate.magnitude > best.magnitude) {
      best = candidate;
    }
  }
  return best?.text ?? null;
}

function tieInsight(snapshot: ErcotSnapshot): string | null {
  const first = snapshot.ties[0];
  if (!first) {
    return null;
  }

  let net = 0;
  let busiest = first;
  for (const tie of snapshot.ties) {
    net += tie.megawatts;
    if (Math.abs(tie.megawatts) > Math.abs(busiest.megawatts)) {
      busiest = tie;
    }
  }

  if (Math.abs(net) < 20) {
    return 'DC tie flows nearly cancel.';
  }

  const netDirection = net < 0 ? 'importing' : 'exporting';
  if (Math.abs(busiest.megawatts) < 5) {
    return `DC ties are ${netDirection} ${formatPower(Math.abs(net))} net.`;
  }
  const busyDirection = busiest.megawatts < 0 ? 'importing' : 'exporting';
  return `DC ties are ${netDirection} ${formatPower(Math.abs(net))} net. ${busiest.name} is the largest flow, ${busyDirection} ${formatPower(Math.abs(busiest.megawatts))}.`;
}
