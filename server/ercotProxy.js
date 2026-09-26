/**
 * Same-origin proxy for ERCOT's public dashboard JSON.
 * Those responses only allow CORS from mis.ercot.com, so the web app cannot
 * fetch them directly. Native builds call ERCOT itself.
 */

const UPSTREAM = 'https://www.ercot.com/api/1/services/read/dashboards/';

const FEEDS = new Set([
  'supply-demand.json',
  'fuel-mix.json',
  'daily-prc.json',
  'energy-storage-resources.json',
  'system-wide-prices.json',
  'generation-outages.json',
  'dc-tie-flows.json',
  'ancillary-service-capacity-monitor.json',
]);

const HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0',
};

async function fetchUpstream(url) {
  let response = await fetch(url, { headers: HEADERS });
  if (response.status === 403 || response.status >= 500) {
    await new Promise((resolve) => {
      setTimeout(resolve, 400);
    });
    response = await fetch(url, { headers: HEADERS });
  }
  return response;
}

function sampleRows(rows, count) {
  if (!Array.isArray(rows) || rows.length <= count) {
    return rows ?? [];
  }

  const last = rows.length - 1;
  const step = last / (count - 1);
  const sampled = [];
  for (let index = 0; index < count; index += 1) {
    sampled.push(rows[Math.round(index * step)]);
  }
  return sampled;
}

function trimFeed(feed, text) {
  try {
    if (feed === 'daily-prc.json') {
      const json = JSON.parse(text);
      return JSON.stringify({
        lastUpdated: json.lastUpdated,
        current_condition: json.current_condition,
        data: sampleRows(json.data, 120),
      });
    }

    if (feed === 'dc-tie-flows.json') {
      const json = JSON.parse(text);
      const data = Array.isArray(json.data) ? json.data : [];
      const latest = data.reduce((best, row) => {
        const epoch = Number(row && row.epoch);
        const bestEpoch = Number(best && best.epoch);
        if (!best || epoch >= bestEpoch) {
          return row;
        }
        return best;
      }, null);
      return JSON.stringify({
        lastUpdated: json.lastUpdated,
        data: latest ? [latest] : [],
      });
    }

    if (feed === 'generation-outages.json') {
      const json = JSON.parse(text);
      const current =
        json.current && typeof json.current === 'object' ? json.current : {};
      const keys = Object.keys(current);
      const lastKey = keys.reduce((best, key) => {
        return Number(key) > Number(best) ? key : best;
      }, keys[0]);
      return JSON.stringify({
        lastUpdated: json.lastUpdated,
        currentOutages: json.currentOutages,
        types: json.types,
        current: lastKey ? { [lastKey]: current[lastKey] } : {},
      });
    }

    return text;
  } catch {
    return text;
  }
}

async function proxyErcot(feed) {
  if (!FEEDS.has(feed)) {
    return {
      status: 404,
      body: JSON.stringify({ error: 'Unknown ERCOT feed' }),
    };
  }

  const response = await fetchUpstream(`${UPSTREAM}${feed}`);
  const text = await response.text();
  if (!response.ok) {
    return {
      status: 502,
      body: JSON.stringify({ error: `ERCOT returned ${response.status}` }),
    };
  }

  return { status: 200, body: trimFeed(feed, text) };
}

module.exports = { proxyErcot };
