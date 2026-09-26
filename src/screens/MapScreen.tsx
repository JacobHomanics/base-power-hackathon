import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErcotMap } from '@/components/ErcotMap';
import type { ErcotMapStatus } from '@/components/ercotMapTypes';
import { APP_BRAND_HEX } from '@/constants/brand';
import type { AppThemeColors } from '@/constants/theme';
import { formatCentralTime, formatPrice } from '@/ercot/format';
import {
  priceFill,
  priceRange,
  type MapRegionView,
  type MapTieView,
} from '@/ercot/geography';
import type { ErcotSnapshot, PriceQuote } from '@/ercot/types';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useErcotSnapshot } from '@/hooks/useErcotSnapshot';
import type { RootStackParamList } from '@/navigation/types';

const EMPTY_TIES: MapTieView[] = [];

const ZONE_SOURCES = [
  { id: 'lzNorth', hubId: 'hbNorth', name: 'North' },
  { id: 'lzHouston', hubId: 'hbHouston', name: 'Houston' },
  { id: 'lzSouth', hubId: 'hbSouth', name: 'South' },
  { id: 'lzWest', hubId: 'hbWest', name: 'West' },
] as const;

export function MapScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { snapshot, error, loading, refreshing, refresh } = useErcotSnapshot();
  const [mapStatus, setMapStatus] = useState<ErcotMapStatus>(
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ? 'ready' : 'missing-key',
  );
  const regions = useMemo(() => buildRegions(snapshot), [snapshot]);
  const ties = snapshot?.ties ?? EMPTY_TIES;
  const range = priceRange(
    regions
      .map((region) => region.realtime)
      .filter((value): value is number => value !== null),
  );

  return (
    <View style={styles.root}>
      <ErcotMap isDark={isDark} regions={regions} ties={ties} onStatus={setMapStatus} />
      <View
        pointerEvents="box-none"
        style={[styles.topBar, { top: insets.top + 12 }]}
      >
        <View style={styles.card}>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              navigation.navigate('home');
            }}
          >
            <Text style={styles.back}>ERCOT</Text>
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>
            Price map
          </Text>
          {snapshot ? (
            <Text style={[styles.kicker, { color: conditionColor(snapshot, colors) }]}>
              {snapshot.conditionTitle}
            </Text>
          ) : null}
          <Text style={styles.meta}>
            {loading && !snapshot
              ? 'Loading ERCOT prices…'
              : snapshot
                ? refreshing
                  ? 'Updating…'
                  : `Updated ${formatCentralTime(snapshot.updatedAt)}`
                : null}
          </Text>
          {error && !snapshot ? <Text style={styles.body}>{error}</Text> : null}
          {mapStatus === 'error' ? (
            <Text style={styles.body}>Google Maps could not load. Check the API key restrictions.</Text>
          ) : null}
          {mapStatus === 'missing-key' ? (
            <Text style={styles.body}>Add a Google Maps API key to draw the map.</Text>
          ) : null}
          {error && !snapshot ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void refresh();
              }}
              style={styles.retry}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <View
        pointerEvents="box-none"
        style={[styles.bottomBar, { bottom: insets.bottom + 28 }]}
      >
        <View style={styles.card}>
          <Text style={styles.legendTitle}>Real-time load zone price</Text>
          <View style={styles.legendRows}>
            {regions.map((region) => (
              <View key={region.id} style={styles.legendRow}>
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: priceFill(region.realtime, range.low, range.high) },
                  ]}
                />
                <Text style={styles.legendName}>{region.name}</Text>
                <Text style={styles.legendValue}>
                  {region.realtime === null ? '—' : formatPrice(region.realtime)}
                </Text>
              </View>
            ))}
          </View>
          <View style={styles.tieKey}>
            <View style={styles.tieKeyItem}>
              <View style={[styles.dot, { backgroundColor: APP_BRAND_HEX }]} />
              <Text style={styles.meta}>Import</Text>
            </View>
            <View style={styles.tieKeyItem}>
              <View style={[styles.dot, { backgroundColor: '#e07a3d' }]} />
              <Text style={styles.meta}>Export</Text>
            </View>
          </View>
          <Text style={styles.caption}>
            Zone shapes are simplified. Dots are the DC ties.
          </Text>
        </View>
      </View>
    </View>
  );
}

function buildRegions(snapshot: ErcotSnapshot | null): MapRegionView[] {
  const quote = (id: string): PriceQuote | undefined =>
    snapshot?.prices.find((price) => price.id === id);

  const zones = ZONE_SOURCES.map((zone) => {
    const zonePrice = quote(zone.id);
    const hubPrice = quote(zone.hubId);
    return {
      id: zone.id,
      name: zone.name,
      kind: 'zone' as const,
      realtime: zonePrice?.realtime ?? null,
      dayAhead: zonePrice?.dayAhead ?? null,
      hubRealtime: hubPrice?.realtime ?? null,
      hubDayAhead: hubPrice?.dayAhead ?? null,
      note: null,
    };
  });

  const panhandle = quote('hbPan');
  return [
    ...zones,
    {
      id: 'hbPan',
      name: 'Panhandle',
      kind: 'hub',
      realtime: panhandle?.realtime ?? null,
      dayAhead: panhandle?.dayAhead ?? null,
      hubRealtime: null,
      hubDayAhead: null,
      note: 'Trading hub for Panhandle wind. Amarillo load is outside ERCOT.',
    },
  ];
}

function conditionColor(snapshot: ErcotSnapshot, colors: AppThemeColors): string {
  if (snapshot.eeaLevel > 0 || /emergency|eea/i.test(snapshot.conditionState)) {
    return colors.error;
  }
  if (/watch|conserv|advisory/i.test(snapshot.conditionState)) {
    return colors.warning;
  }
  return colors.positive;
}

function createStyles(colors: AppThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    topBar: {
      position: 'absolute',
      left: 12,
      right: 12,
      alignItems: 'flex-start',
    },
    bottomBar: {
      position: 'absolute',
      left: 12,
      right: 12,
      alignItems: 'flex-end',
    },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 16,
      borderWidth: 1,
      maxWidth: 320,
      padding: 14,
    },
    back: {
      color: colors.brandAccent,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.4,
    },
    title: {
      marginTop: 4,
      color: colors.text,
      fontSize: 22,
      fontWeight: '700',
    },
    kicker: {
      marginTop: 6,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    meta: {
      marginTop: 4,
      color: colors.textSecondary,
      fontSize: 13,
    },
    body: {
      marginTop: 8,
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
    retry: {
      alignSelf: 'flex-start',
      backgroundColor: colors.brand,
      borderRadius: 999,
      marginTop: 12,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    retryText: {
      color: colors.onBrand,
      fontWeight: '600',
    },
    legendTitle: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    legendRows: {
      marginTop: 8,
      gap: 6,
    },
    legendRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    swatch: {
      width: 12,
      height: 12,
      borderRadius: 6,
    },
    legendName: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    legendValue: {
      color: colors.text,
      fontSize: 14,
      fontVariant: ['tabular-nums'],
      fontWeight: '700',
    },
    tieKey: {
      flexDirection: 'row',
      gap: 14,
      marginTop: 10,
    },
    tieKeyItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    caption: {
      marginTop: 8,
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 16,
    },
  });
}
