import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useMemo, type ReactNode } from 'react';
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Sparkline } from '@/components/Sparkline';
import { APP_BRAND_HEX } from '@/constants/brand';
import type { AppThemeColors } from '@/constants/theme';
import {
  formatCentralTime,
  formatHertz,
  formatMegawattSeconds,
  formatPercent,
  formatPower,
  formatPrice,
  formatSignedPrice,
  seriesExtent,
} from '@/ercot/format';
import { ercotInsights } from '@/ercot/insights';
import type { ErcotSnapshot, PriceQuote } from '@/ercot/types';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useErcotSnapshot } from '@/hooks/useErcotSnapshot';
import { useIsDesktopWeb } from '@/hooks/useIsDesktopWeb';
import type { RootStackParamList } from '@/navigation/types';

const ERCOT_DASHBOARDS = 'https://www.ercot.com/gridmktinfo/dashboards';

const FUEL_COLORS: Record<string, string> = {
  'Natural Gas': '#e07a3d',
  'Coal and Lignite': '#8a8178',
  Nuclear: '#8b6fd4',
  Wind: '#2a9d8f',
  Solar: '#e9b308',
  Hydro: '#3d7ec9',
  'Power Storage': APP_BRAND_HEX,
  Other: '#8892a4',
};

export function ErcotScreen() {
  const { colors } = useAppTheme();
  const isWide = useIsDesktopWeb();
  const styles = useMemo(() => createStyles(colors, isWide), [colors, isWide]);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { snapshot, error, loading, refreshing, refresh } = useErcotSnapshot();

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 24,
            paddingBottom: insets.bottom + 32,
          },
        ]}
        refreshControl={
          <RefreshControl
            onRefresh={() => {
              void refresh();
            }}
            refreshing={refreshing}
            tintColor={colors.brand}
          />
        }
        style={styles.scroll}
      >
        <View style={styles.column}>
          <ScreenHeader
            subtitle="Live supply, prices, batteries, and reserves from the Texas grid."
            title="ERCOT"
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              navigation.navigate('map');
            }}
            style={styles.mapLink}
          >
            <Text style={styles.link}>Open price map</Text>
          </Pressable>
          {loading && !snapshot ? (
            <Text style={styles.status}>Loading the Texas grid…</Text>
          ) : null}
          {error && !snapshot ? (
            <View style={styles.card}>
              <Text style={styles.body}>{error}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void refresh();
                }}
                style={styles.button}
              >
                <Text style={styles.buttonText}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
          {snapshot ? (
            <Dashboard
              colors={colors}
              refreshing={refreshing}
              snapshot={snapshot}
              styles={styles}
              onRefresh={() => {
                void refresh();
              }}
            />
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function Dashboard({
  colors,
  refreshing,
  snapshot,
  styles,
  onRefresh,
}: {
  colors: AppThemeColors;
  refreshing: boolean;
  snapshot: ErcotSnapshot;
  styles: DashboardStyles;
  onRefresh: () => void;
}) {
  const insights = ercotInsights(snapshot);
  const tone = conditionColor(snapshot, colors);
  const hub = snapshot.prices.find((price) => price.id === 'hbHubAvg');
  const positiveGeneration = snapshot.fuels.reduce(
    (sum, fuel) => sum + Math.max(0, fuel.megawatts),
    0,
  );
  const fuels = [...snapshot.fuels].sort((left, right) => right.megawatts - left.megawatts);
  const demandExtent = seriesExtent(snapshot.demandSeries);
  const reserveExtent = seriesExtent(snapshot.prcSeries);
  const netInterchange = snapshot.ties.reduce((sum, tie) => sum + tie.megawatts, 0);

  return (
    <View>
      <View style={[styles.banner, { borderColor: tone }]}>
        <Text style={[styles.kicker, { color: tone }]}>{snapshot.conditionTitle}</Text>
        {snapshot.conditionNote ? (
          <Text style={styles.bannerBody}>{snapshot.conditionNote}</Text>
        ) : null}
        <Text style={styles.meta}>
          {formatPower(snapshot.prcMegawatts)} of operating reserves
          {snapshot.eeaLevel > 0 ? ` · EEA ${snapshot.eeaLevel}` : ''}
        </Text>
      </View>

      {insights.length > 0 ? (
        <View style={styles.insights}>
          {insights.map((insight) => (
            <Text key={insight} style={styles.insight}>
              {insight}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.metaRow}>
        <Text style={styles.updated}>
          {refreshing ? 'Updating…' : `Updated ${formatCentralTime(snapshot.updatedAt)}`}
        </Text>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={onRefresh}>
          <Text style={styles.link}>Refresh</Text>
        </Pressable>
      </View>

      <View style={styles.metrics}>
        <Metric
          hint="System load"
          label="Demand"
          styles={styles}
          value={formatPower(snapshot.demandMegawatts)}
        />
        <Metric
          hint="Capacity minus demand"
          label="Headroom"
          styles={styles}
          value={formatPower(snapshot.headroomMegawatts)}
          valueColor={snapshot.headroomMegawatts < 8000 ? colors.warning : colors.text}
        />
        {hub?.realtime !== null && hub?.realtime !== undefined ? (
          <Metric
            hint={
              hub.dayAhead === null
                ? 'Real-time hub average'
                : `Day-ahead ${formatPrice(hub.dayAhead)}`
            }
            label="Hub price"
            styles={styles}
            value={formatPrice(hub.realtime)}
          />
        ) : null}
        {snapshot.frequencyHertz !== null ? (
          <Metric
            hint="System frequency"
            label="Frequency"
            styles={styles}
            value={formatHertz(snapshot.frequencyHertz)}
            valueColor={
              Math.abs(snapshot.frequencyHertz - 60) >= 0.03 ? colors.warning : colors.text
            }
          />
        ) : null}
      </View>

      <Section styles={styles} title="Demand today">
        <Sparkline color={colors.brand} values={snapshot.demandSeries} />
        {demandExtent ? (
          <Text style={styles.caption}>
            Low {formatPower(demandExtent.min)} · Peak {formatPower(demandExtent.max)} · Now{' '}
            {formatPower(snapshot.demandMegawatts)} of {formatPower(snapshot.capacityMegawatts)}{' '}
            capacity
          </Text>
        ) : null}
      </Section>

      <Section
        styles={styles}
        subtitle="Physical responsive capability. ERCOT declares an emergency if this keeps falling."
        title="Operating reserves"
      >
        <Text style={styles.figure}>{formatPower(snapshot.prcMegawatts)}</Text>
        <Sparkline color={colors.positive} values={snapshot.prcSeries} />
        {reserveExtent ? (
          <Text style={styles.caption}>
            Today’s range {formatPower(reserveExtent.min)} to {formatPower(reserveExtent.max)}
          </Text>
        ) : null}
      </Section>

      <Section styles={styles} title="Generation mix">
        <Text style={styles.caption}>{formatPower(positiveGeneration)} generating</Text>
        <View
          accessibilityLabel={fuels
            .map((fuel) => `${fuel.name} ${formatPower(fuel.megawatts)}`)
            .join(', ')}
          style={styles.mix}
        >
          {fuels
            .filter((fuel) => fuel.megawatts > 0)
            .map((fuel) => (
              <View
                key={fuel.name}
                style={{
                  flex: fuel.megawatts,
                  backgroundColor: fuelColor(fuel.name),
                }}
              />
            ))}
        </View>
        {fuels.map((fuel) => {
          const share =
            fuel.megawatts > 0 && positiveGeneration > 0
              ? formatPercent(fuel.megawatts / positiveGeneration)
              : 'Charging';
          return (
            <View key={fuel.name} style={styles.fuelRow}>
              <View style={[styles.swatch, { backgroundColor: fuelColor(fuel.name) }]} />
              <View style={styles.fuelCopy}>
                <Text style={styles.rowTitle}>{fuel.name}</Text>
                {fuel.capacityMegawatts !== null ? (
                  <Text style={styles.caption}>
                    of {formatPower(fuel.capacityMegawatts)} installed
                  </Text>
                ) : null}
              </View>
              <View style={styles.fuelNumbers}>
                <Text style={styles.rowValue}>{formatPower(fuel.megawatts)}</Text>
                <Text style={styles.caption}>{share}</Text>
              </View>
            </View>
          );
        })}
      </Section>

      {snapshot.storage ? (
        <Section
          styles={styles}
          subtitle="Grid-scale storage. Above zero on the chart is power flowing onto the grid."
          title="Batteries"
        >
          <View style={styles.metrics}>
            <Metric
              label="Discharging"
              styles={styles}
              value={formatPower(snapshot.storage.dischargingMegawatts)}
            />
            <Metric
              label="Charging"
              styles={styles}
              value={formatPower(snapshot.storage.chargingMegawatts)}
            />
            <Metric
              label="Net"
              styles={styles}
              value={formatPower(snapshot.storage.netMegawatts)}
            />
          </View>
          {snapshot.storage.capacityMegawatts ? (
            <Text style={styles.caption}>
              {formatPercent(
                snapshot.storage.dischargingMegawatts / snapshot.storage.capacityMegawatts,
              )}{' '}
              of {formatPower(snapshot.storage.capacityMegawatts)} installed is discharging
            </Text>
          ) : null}
          <Sparkline color={APP_BRAND_HEX} values={snapshot.storage.netSeries} />
        </Section>
      ) : null}

      {snapshot.prices.length > 0 ? (
        <Section
          styles={styles}
          subtitle="15-minute real-time prices, beside day-ahead for the current hour."
          title="Prices"
        >
          <Sparkline color={colors.warning} values={snapshot.hubAverageSeries} />
          <Text style={styles.caption}>Real-time hub average today</Text>
          <PriceList colors={colors} prices={snapshot.prices} styles={styles} />
        </Section>
      ) : null}

      {snapshot.outages ? (
        <Section styles={styles} subtitle="Generation capacity offline right now." title="Outages">
          <Text style={styles.figure}>{formatPower(snapshot.outages.totalMegawatts)} offline</Text>
          <View style={styles.metrics}>
            <Metric
              label="Unplanned"
              styles={styles}
              value={formatPower(snapshot.outages.unplannedMegawatts)}
            />
            <Metric
              label="Planned"
              styles={styles}
              value={formatPower(snapshot.outages.plannedMegawatts)}
            />
            <Metric
              label="Dispatchable"
              styles={styles}
              value={formatPower(snapshot.outages.dispatchableMegawatts)}
            />
            <Metric
              label="Renewable"
              styles={styles}
              value={formatPower(snapshot.outages.renewableMegawatts)}
            />
          </View>
        </Section>
      ) : null}

      {snapshot.ties.length > 0 ? (
        <Section
          styles={styles}
          subtitle="East and North leave ERCOT. Laredo and Railroad connect to Mexico."
          title="DC ties"
        >
          <Text style={styles.figure}>{describeInterchange(netInterchange)}</Text>
          {snapshot.inertiaMegawattSeconds !== null ? (
            <Text style={styles.caption}>
              System inertia {formatMegawattSeconds(snapshot.inertiaMegawattSeconds)}
            </Text>
          ) : null}
          {snapshot.ties.map((tie) => (
            <View key={tie.name} style={styles.splitRow}>
              <Text style={styles.rowTitle}>{tie.name}</Text>
              <Text style={styles.rowValue}>{describeFlow(tie.megawatts)}</Text>
            </View>
          ))}
        </Section>
      ) : null}

      {snapshot.reserves.length > 0 ? (
        <Section
          styles={styles}
          subtitle="Ancillary service capability on the system right now."
          title="Ancillary services"
        >
          {snapshot.reserves.map((reserve) => (
            <View key={reserve.name} style={styles.splitRow}>
              <Text style={styles.rowTitle}>{reserve.name}</Text>
              <Text style={styles.rowValue}>
                {reserve.deployedMegawatts === null
                  ? formatPower(reserve.capacityMegawatts)
                  : `${formatPower(reserve.deployedMegawatts)} deployed · ${formatPower(reserve.capacityMegawatts)}`}
              </Text>
            </View>
          ))}
        </Section>
      ) : null}

      {snapshot.tightestHour || snapshot.peakForecast ? (
        <Section
          styles={styles}
          subtitle="ERCOT’s six-day outlook. Demand and available capacity both move as the operating day gets closer."
          title="Coming up"
        >
          <View style={styles.outlookRow}>
            {snapshot.tightestHour ? (
              <View style={styles.outlook}>
                <Text style={styles.metricLabel}>Tightest hour</Text>
                <Text style={styles.rowTitle}>{snapshot.tightestHour.label}</Text>
                <Text style={styles.caption}>
                  {formatPower(snapshot.tightestHour.demandMegawatts)} demand ·{' '}
                  {formatPower(snapshot.tightestHour.capacityMegawatts)} available
                </Text>
                <Text style={styles.rowValue}>
                  {formatPower(snapshot.tightestHour.marginMegawatts)} margin
                </Text>
              </View>
            ) : null}
            {snapshot.peakForecast ? (
              <View style={styles.outlook}>
                <Text style={styles.metricLabel}>Highest forecast demand</Text>
                <Text style={styles.rowTitle}>{snapshot.peakForecast.label}</Text>
                <Text style={styles.rowValue}>
                  {formatPower(snapshot.peakForecast.demandMegawatts)}
                </Text>
                <Text style={styles.caption}>
                  {formatPower(snapshot.peakForecast.capacityMegawatts)} available
                </Text>
              </View>
            ) : null}
          </View>
        </Section>
      ) : null}

      <Pressable
        accessibilityRole="link"
        onPress={() => {
          void Linking.openURL(ERCOT_DASHBOARDS);
        }}
        style={styles.source}
      >
        <Text style={styles.caption}>
          Source: ERCOT public dashboards. Figures can lag telemetry by a few minutes.
        </Text>
      </Pressable>
    </View>
  );
}

function PriceList({
  colors,
  prices,
  styles,
}: {
  colors: AppThemeColors;
  prices: PriceQuote[];
  styles: DashboardStyles;
}) {
  const groups = groupPrices(prices);

  return (
    <View>
      {groups.map((group) => (
        <View key={group.group}>
          <Text style={styles.groupLabel}>{group.group}</Text>
          {group.prices.map((price) => {
            const delta =
              price.realtime !== null && price.dayAhead !== null
                ? price.realtime - price.dayAhead
                : null;
            const deltaColor =
              delta === null
                ? colors.textMuted
                : delta >= 15
                  ? colors.warning
                  : delta <= -5
                    ? colors.positive
                    : colors.textSecondary;

            return (
              <View key={price.id}>
                <View style={styles.priceRow}>
                  <Text style={styles.rowTitle}>{price.label}</Text>
                  <Text style={styles.rowValue}>
                    {price.realtime === null ? '—' : formatPrice(price.realtime)}
                  </Text>
                </View>
                <View style={styles.priceMeta}>
                  <Text style={styles.caption}>
                    {price.dayAhead === null
                      ? 'Day-ahead unavailable'
                      : `Day-ahead ${formatPrice(price.dayAhead)}`}
                  </Text>
                  {delta !== null ? (
                    <Text style={[styles.caption, { color: deltaColor }]}>
                      {formatSignedPrice(delta)}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function groupPrices(prices: PriceQuote[]): { group: PriceQuote['group']; prices: PriceQuote[] }[] {
  const groups: { group: PriceQuote['group']; prices: PriceQuote[] }[] = [];
  for (const price of prices) {
    const current = groups[groups.length - 1];
    if (!current || current.group !== price.group) {
      groups.push({ group: price.group, prices: [price] });
      continue;
    }
    current.prices.push(price);
  }
  return groups;
}

function Section({
  children,
  styles,
  subtitle,
  title,
}: {
  children: ReactNode;
  styles: DashboardStyles;
  subtitle?: string;
  title: string;
}) {
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
        {title}
      </Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

function Metric({
  hint,
  label,
  styles,
  value,
  valueColor,
}: {
  hint?: string;
  label: string;
  styles: DashboardStyles;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
      {hint ? <Text style={styles.metricHint}>{hint}</Text> : null}
    </View>
  );
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

function fuelColor(name: string): string {
  return FUEL_COLORS[name] ?? '#8892a4';
}

function describeFlow(megawatts: number): string {
  if (Math.abs(megawatts) < 5) {
    return 'Quiet';
  }
  const amount = formatPower(Math.abs(megawatts));
  return megawatts < 0 ? `Importing ${amount}` : `Exporting ${amount}`;
}

function describeInterchange(megawatts: number): string {
  if (Math.abs(megawatts) < 5) {
    return 'Interchange is balanced';
  }
  const amount = formatPower(Math.abs(megawatts));
  return megawatts < 0 ? `Net import ${amount}` : `Net export ${amount}`;
}

type DashboardStyles = ReturnType<typeof createStyles>;

function createStyles(colors: AppThemeColors, isWide: boolean) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scroll: {
      flex: 1,
    },
    content: {
      paddingHorizontal: 24,
    },
    column: {
      width: '100%',
      maxWidth: 960,
      alignSelf: 'center',
    },
    status: {
      marginTop: 24,
      color: colors.textSecondary,
      fontSize: 16,
    },
    body: {
      color: colors.text,
      fontSize: 16,
      lineHeight: 24,
    },
    button: {
      alignSelf: 'flex-start',
      marginTop: 16,
      backgroundColor: colors.brand,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    buttonText: {
      color: colors.onBrand,
      fontWeight: '600',
    },
    banner: {
      marginTop: 20,
      borderWidth: 1,
      borderRadius: 16,
      backgroundColor: colors.surface,
      padding: 16,
    },
    kicker: {
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    bannerBody: {
      marginTop: 8,
      color: colors.text,
      fontSize: 18,
      lineHeight: 26,
      fontWeight: '600',
    },
    insights: {
      marginTop: 12,
      gap: 6,
    },
    insight: {
      color: colors.text,
      fontSize: 16,
      lineHeight: 24,
    },
    metaRow: {
      marginTop: 14,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    meta: {
      marginTop: 8,
      color: colors.textSecondary,
      fontSize: 14,
    },
    updated: {
      color: colors.textSecondary,
      fontSize: 14,
    },
    mapLink: {
      alignSelf: 'flex-start',
      marginTop: 16,
    },
    link: {
      color: colors.brandAccent,
      fontSize: 14,
      fontWeight: '600',
    },
    metrics: {
      marginTop: 12,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    metric: {
      flexGrow: 1,
      flexBasis: isWide ? '22%' : '46%',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 16,
      padding: 14,
    },
    metricLabel: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    metricValue: {
      marginTop: 6,
      color: colors.text,
      fontSize: isWide ? 28 : 22,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    metricHint: {
      marginTop: 4,
      color: colors.textSecondary,
      fontSize: 13,
    },
    card: {
      marginTop: 16,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 16,
      padding: 16,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 20,
      fontWeight: '700',
    },
    sectionSubtitle: {
      marginTop: 6,
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
    },
    figure: {
      marginTop: 12,
      color: colors.text,
      fontSize: 28,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    caption: {
      marginTop: 6,
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    mix: {
      marginTop: 12,
      height: 14,
      borderRadius: 7,
      overflow: 'hidden',
      flexDirection: 'row',
      backgroundColor: colors.border,
    },
    fuelRow: {
      marginTop: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    swatch: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    fuelCopy: {
      flex: 1,
    },
    fuelNumbers: {
      alignItems: 'flex-end',
    },
    rowTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    rowValue: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    splitRow: {
      marginTop: 12,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    },
    groupLabel: {
      marginTop: 16,
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    priceRow: {
      marginTop: 10,
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
    },
    priceMeta: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
    },
    outlookRow: {
      marginTop: 12,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    outlook: {
      flexGrow: 1,
      flexBasis: 220,
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 12,
    },
    source: {
      marginTop: 18,
    },
  });
}
