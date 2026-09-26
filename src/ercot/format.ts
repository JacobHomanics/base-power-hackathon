const CENTRAL = 'America/Chicago';

export function parseErcotTime(value: string): Date | null {
  const iso = value
    .trim()
    .replace(' ', 'T')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatCentralTime(date: Date): string {
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  return `${time} CT`;
}

export function formatHourEndingRange(timestamp: string): string {
  const end = parseErcotTime(timestamp);
  if (!end) {
    return timestamp;
  }

  const start = new Date(end.getTime() - 60 * 60 * 1000);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL,
    weekday: 'short',
  }).format(start);
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL,
    hour: 'numeric',
  });

  return `${weekday} ${hour.format(start)}–${hour.format(end)}`;
}

export function formatPower(megawatts: number): string {
  const sign = megawatts < 0 ? '-' : '';
  const absolute = Math.abs(megawatts);

  if (absolute >= 1000) {
    const gigawatts = absolute / 1000;
    const digits = gigawatts >= 100 ? 0 : 1;
    return `${sign}${gigawatts.toFixed(digits)} GW`;
  }

  if (absolute >= 100) {
    return `${sign}${Math.round(absolute).toLocaleString('en-US')} MW`;
  }

  if (absolute < 0.05) {
    return '0 MW';
  }

  const digits = absolute >= 10 ? 0 : 1;
  return `${sign}${absolute.toFixed(digits)} MW`;
}

export function formatPrice(dollarsPerMegawattHour: number): string {
  return `$${dollarsPerMegawattHour.toFixed(2)}`;
}

export function formatSignedPrice(dollarsPerMegawattHour: number): string {
  const sign = dollarsPerMegawattHour > 0 ? '+' : dollarsPerMegawattHour < 0 ? '-' : '';
  return `${sign}$${Math.abs(dollarsPerMegawattHour).toFixed(2)}`;
}

export function formatPercent(fraction: number): string {
  const percent = fraction * 100;
  if (percent > 0 && percent < 0.5) {
    return '<1%';
  }
  return `${Math.round(percent)}%`;
}

export function formatHertz(hertz: number): string {
  return `${hertz.toFixed(3)} Hz`;
}

export function formatMegawattSeconds(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} MW·s`;
}

export function seriesExtent(values: number[]): { min: number; max: number } | null {
  const first = values[0];
  if (first === undefined) {
    return null;
  }

  let min = first;
  let max = first;
  for (const value of values) {
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }

  return { min, max };
}
