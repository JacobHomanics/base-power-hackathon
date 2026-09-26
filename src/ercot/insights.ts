import { formatPower, formatPrice } from '@/ercot/format';
import type { ErcotSnapshot, PriceQuote } from '@/ercot/types';

function quote(snapshot: ErcotSnapshot, id: string): PriceQuote | undefined {
  return snapshot.prices.find((price) => price.id === id);
}

function priceDelta(price: PriceQuote | undefined): number | null {
  if (!price || price.realtime === null || price.dayAhead === null) {
    return null;
  }
  return price.realtime - price.dayAhead;
}

export function ercotInsights(snapshot: ErcotSnapshot): string[] {
  const lines: string[] = [];
  const totalGeneration = snapshot.fuels.reduce(
    (sum, fuel) => sum + Math.max(0, fuel.megawatts),
    0,
  );
  const storage = snapshot.fuels.find((fuel) => fuel.name === 'Power Storage');
  const hubDelta = priceDelta(quote(snapshot, 'hbHubAvg'));
  const west = quote(snapshot, 'hbWest');
  const houston = quote(snapshot, 'hbHouston');
  const wind = snapshot.fuels.find((fuel) => fuel.name === 'Wind');
  const solar = snapshot.fuels.find((fuel) => fuel.name === 'Solar');

  if (snapshot.frequencyHertz !== null && Math.abs(snapshot.frequencyHertz - 60) >= 0.03) {
    lines.push(`Frequency is ${snapshot.frequencyHertz.toFixed(3)} Hz.`);
  }

  if (snapshot.headroomMegawatts < 8000) {
    lines.push(`Headroom is down to ${formatPower(snapshot.headroomMegawatts)}.`);
  }

  if (storage && storage.megawatts >= 500 && totalGeneration > 0) {
    const share = Math.round((storage.megawatts / totalGeneration) * 100);
    lines.push(`Batteries are supplying ${share}% of generation.`);
  } else if (snapshot.storage && snapshot.storage.chargingMegawatts >= 500) {
    lines.push(`Batteries are charging at ${formatPower(snapshot.storage.chargingMegawatts)}.`);
  }

  if (hubDelta !== null && Math.abs(hubDelta) >= 8) {
    const direction = hubDelta > 0 ? 'above' : 'below';
      lines.push(
        `Real-time hub prices are ${formatPrice(Math.abs(hubDelta))} ${direction} the day-ahead price.`,
      );
  }

  if (
    west?.realtime !== null &&
    west?.realtime !== undefined &&
    houston?.realtime !== null &&
    houston?.realtime !== undefined
  ) {
    const spread = west.realtime - houston.realtime;
    if (Math.abs(spread) >= 10) {
      const direction = spread > 0 ? 'above' : 'below';
      lines.push(`The West hub is ${formatPrice(Math.abs(spread))} ${direction} the Houston hub.`);
    }
  }

  if (snapshot.outages && snapshot.outages.unplannedMegawatts >= 15000) {
    lines.push(
      `Unplanned outages total ${formatPower(snapshot.outages.unplannedMegawatts)}.`,
    );
  }

  for (const fuel of [solar, wind]) {
    if (!fuel || fuel.megawatts < 0 || totalGeneration <= 0) {
      continue;
    }
    const share = fuel.megawatts / totalGeneration;
    if (share >= 0.25) {
      lines.push(`${fuel.name} is ${Math.round(share * 100)}% of generation.`);
    }
  }

  return lines.slice(0, 3);
}
