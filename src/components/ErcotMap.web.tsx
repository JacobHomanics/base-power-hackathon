import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { unstable_createElement as createDomElement } from 'react-native-web';

import type { ErcotMapProps } from '@/components/ercotMapTypes';
import {
  loadGoogleMaps,
  type GoogleInfoWindow,
  type GoogleMap,
  type GoogleOverlay,
} from '@/components/loadGoogleMaps';
import { APP_BRAND_HEX } from '@/constants/brand';
import { formatPower, formatPrice, formatSignedPrice } from '@/ercot/format';
import {
  priceFill,
  priceRange,
  REGION_PLACES,
  TIE_PLACES,
  type MapLatLng,
  type MapRegionView,
  type MapTieView,
} from '@/ercot/geography';

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

const DARK_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#1b2433' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#c5cddb' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1b2433' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#3d4a60' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a3344' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1622' }] },
];

const LIGHT_STYLES = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

const canvasStyle = {
  position: 'absolute' as const,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

export function ErcotMap({ regions, ties, isDark, onStatus }: ErcotMapProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const mapRef = useRef<GoogleMap | null>(null);
  const infoRef = useRef<GoogleInfoWindow | null>(null);
  const overlaysRef = useRef<GoogleOverlay[]>([]);
  const fittedRef = useRef(false);

  const setHostNode = useCallback((node: unknown) => {
    if (node instanceof HTMLElement) {
      setHost((current) => (current === node ? current : node));
    }
  }, []);

  useEffect(() => {
    if (!host || !API_KEY) {
      return;
    }

    let cancelled = false;
    window.gm_authFailure = () => {
      if (!cancelled) {
        onStatus?.('error');
      }
    };

    loadGoogleMaps(API_KEY)
      .then((maps) => {
        if (cancelled || mapRef.current) {
          return;
        }

        mapRef.current = new maps.Map(host, {
          center: { lat: 31.2, lng: -99.2 },
          clickableIcons: false,
          fullscreenControl: false,
          gestureHandling: 'greedy',
          mapTypeControl: false,
          streetViewControl: false,
          styles: isDark ? DARK_STYLES : LIGHT_STYLES,
          zoom: 6,
        });
        infoRef.current = new maps.InfoWindow();
        setReady(true);
        onStatus?.('ready');
      })
      .catch(() => {
        if (!cancelled) {
          onStatus?.('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [host, isDark, onStatus]);

  useEffect(() => {
    const map = mapRef.current;
    const info = infoRef.current;
    const maps = window.google?.maps;
    if (!map || !info || !maps || !ready) {
      return;
    }

    drawOverlays(maps, map, info, regions, ties, isDark, overlaysRef, fittedRef);
  }, [regions, ties, isDark, ready]);

  return (
    <View style={styles.fill}>
      {createDomElement('div', {
        ref: setHostNode,
        style: canvasStyle,
      })}
    </View>
  );
}

function drawOverlays(
  maps: NonNullable<Window['google']>['maps'],
  map: GoogleMap,
  info: GoogleInfoWindow,
  regions: MapRegionView[],
  ties: MapTieView[],
  isDark: boolean,
  overlaysRef: { current: GoogleOverlay[] },
  fittedRef: { current: boolean },
) {
  info.close();
  for (const overlay of overlaysRef.current) {
    maps.event.clearInstanceListeners(overlay);
    overlay.setMap(null);
  }
  overlaysRef.current = [];

  map.setOptions({ styles: isDark ? DARK_STYLES : LIGHT_STYLES });

  const prices = regions
    .map((region) => region.realtime)
    .filter((value): value is number => value !== null);
  const range = priceRange(prices);
  const peakZoneId = expensiveZoneId(regions);
  const bounds = new maps.LatLngBounds();

  for (const region of regions) {
    const place = REGION_PLACES[region.id];
    if (!place) {
      continue;
    }

    const color = priceFill(region.realtime, range.low, range.high);
    bounds.extend(place.label);

    if (place.path) {
      const polygon = new maps.Polygon({
        clickable: true,
        fillColor: color,
        fillOpacity: isDark ? 0.62 : 0.48,
        map,
        paths: place.path,
        strokeColor: region.id === peakZoneId ? '#ffffff' : isDark ? '#f5f7fb' : '#102033',
        strokeOpacity: region.id === peakZoneId ? 0.95 : 0.75,
        strokeWeight: region.id === peakZoneId ? 3 : 1.5,
        zIndex: 1,
      });
      polygon.addListener('click', () => {
        openRegion(info, map, region, place.label);
      });
      overlaysRef.current.push(polygon);
      for (const point of place.path) {
        bounds.extend(point);
      }
    }

    const marker = new maps.Marker({
      icon: {
        fillColor: '#ffffff',
        fillOpacity: 0.95,
        path: maps.SymbolPath.CIRCLE,
        scale: region.kind === 'hub' ? 16 : 20,
        strokeColor: color,
        strokeWeight: 3,
      },
      label: {
        color: '#102033',
        fontSize: '12px',
        fontWeight: '700',
        text: region.realtime === null ? '—' : `$${Math.round(region.realtime)}`,
      },
      map,
      position: place.label,
      zIndex: 3,
    });
    marker.addListener('click', () => {
      openRegion(info, map, region, place.label);
    });
    overlaysRef.current.push(marker);
  }

  for (const tie of ties) {
    const place = TIE_PLACES[tie.name];
    if (!place) {
      continue;
    }

    const marker = new maps.Marker({
      icon: {
        fillColor: tieColor(tie.megawatts),
        fillOpacity: 1,
        path: maps.SymbolPath.CIRCLE,
        scale: tieLabel(tie.megawatts) ? 16 : 9,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      },
      label: tieLabel(tie.megawatts)
        ? {
            color: '#ffffff',
            fontSize: '11px',
            fontWeight: '700',
            text: tieLabel(tie.megawatts),
          }
        : undefined,
      map,
      position: place.position,
      title: `${place.title}, ${describeTie(tie.megawatts)}`,
      zIndex: 4,
    });
    marker.addListener('click', () => {
      info.setPosition(place.position);
      info.setContent(
        infoElement([
          { strong: true, text: place.title },
          { text: place.detail },
          { text: describeTie(tie.megawatts) },
        ]),
      );
      info.open({ anchor: marker, map });
    });
    overlaysRef.current.push(marker);
    bounds.extend(place.position);
  }

  for (const place of Object.values(TIE_PLACES)) {
    bounds.extend(place.position);
  }
  bounds.extend(REGION_PLACES.hbPan?.label ?? { lat: 35.4, lng: -101.4 });

  if (!fittedRef.current) {
    map.fitBounds(bounds, { bottom: 72, left: 48, right: 48, top: 120 });
    fittedRef.current = true;
  }
}

function openRegion(
  info: GoogleInfoWindow,
  map: GoogleMap,
  region: MapRegionView,
  position: MapLatLng,
) {
  const lines: { strong?: boolean; text: string }[] = [
    {
      strong: true,
      text: region.kind === 'hub' ? `${region.name} hub` : `${region.name} load zone`,
    },
  ];
  if (region.realtime !== null) {
    lines.push({ text: `Real-time ${formatPrice(region.realtime)}` });
  }
  if (region.dayAhead !== null) {
    lines.push({ text: `Day-ahead ${formatPrice(region.dayAhead)}` });
  }
  if (region.realtime !== null && region.dayAhead !== null) {
    lines.push({
      text: `${formatSignedPrice(region.realtime - region.dayAhead)} vs day-ahead`,
    });
  }
  if (region.hubRealtime !== null && region.realtime !== null) {
    const gap = region.realtime - region.hubRealtime;
    lines.push({
      text: `Trading hub ${formatPrice(region.hubRealtime)} (${formatSignedPrice(gap)} on the zone)`,
    });
  }
  if (region.note) {
    lines.push({ text: region.note });
  }

  info.setPosition(position);
  info.setContent(infoElement(lines));
  info.open({ map });
}

function infoElement(lines: { strong?: boolean; text: string }[]): HTMLElement {
  const root = document.createElement('div');
  root.style.fontFamily = 'system-ui, sans-serif';
  root.style.maxWidth = '240px';
  root.style.padding = '2px 0';

  for (const [index, line] of lines.entries()) {
    const row = document.createElement('div');
    row.textContent = line.text;
    row.style.color = '#102033';
    row.style.fontSize = line.strong ? '15px' : '13px';
    row.style.fontWeight = line.strong ? '700' : '500';
    row.style.lineHeight = '18px';
    row.style.marginTop = index === 0 ? '0' : '4px';
    root.appendChild(row);
  }

  return root;
}

function expensiveZoneId(regions: MapRegionView[]): string | null {
  let peak: MapRegionView | null = null;
  for (const region of regions) {
    if (region.kind !== 'zone' || region.realtime === null) {
      continue;
    }
    if (!peak || peak.realtime === null || region.realtime > peak.realtime) {
      peak = region;
    }
  }
  return peak?.id ?? null;
}

function tieLabel(megawatts: number): string {
  if (Math.abs(megawatts) < 5) {
    return '';
  }
  return String(Math.round(Math.abs(megawatts)));
}

function tieColor(megawatts: number): string {
  if (megawatts < -5) {
    return APP_BRAND_HEX;
  }
  if (megawatts > 5) {
    return '#e07a3d';
  }
  return '#8892a4';
}

function describeTie(megawatts: number): string {
  if (Math.abs(megawatts) < 5) {
    return 'Quiet';
  }
  const amount = formatPower(Math.abs(megawatts));
  return megawatts < 0 ? `Importing ${amount}` : `Exporting ${amount}`;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    minHeight: 320,
    position: 'relative',
  },
});
