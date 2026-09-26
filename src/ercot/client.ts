import { Platform } from 'react-native';

import { parseErcotSnapshot } from '@/ercot/parse';
import type { ErcotSnapshot } from '@/ercot/types';

const FEEDS = [
  'supply-demand.json',
  'fuel-mix.json',
  'daily-prc.json',
  'energy-storage-resources.json',
  'system-wide-prices.json',
  'generation-outages.json',
  'dc-tie-flows.json',
  'ancillary-service-capacity-monitor.json',
] as const;

const UPSTREAM = 'https://www.ercot.com/api/1/services/read/dashboards/';

function feedUrl(feed: (typeof FEEDS)[number]): string {
  if (Platform.OS === 'web') {
    return `/api/ercot/${feed}`;
  }
  return `${UPSTREAM}${feed}`;
}

async function fetchFeed(feed: (typeof FEEDS)[number]): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(feedUrl(feed), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`ERCOT ${feed} returned ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchErcotSnapshot(): Promise<ErcotSnapshot> {
  const entries = await Promise.all(
    FEEDS.map(async (feed) => [feed, await fetchFeed(feed)] as const),
  );
  return parseErcotSnapshot(Object.fromEntries(entries));
}
