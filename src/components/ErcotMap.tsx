import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ErcotMapProps } from '@/components/ercotMapTypes';
import type { AppThemeColors } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';

export function ErcotMap({ regions, ties }: ErcotMapProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.fill}>
      <Text style={styles.title}>Google Maps is available on the web.</Text>
      <Text style={styles.body}>
        {regions.length} regions and {ties.length} DC ties are ready to draw there.
      </Text>
    </View>
  );
}

function createStyles(colors: AppThemeColors) {
  return StyleSheet.create({
    fill: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      padding: 24,
    },
    title: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
      textAlign: 'center',
    },
    body: {
      marginTop: 8,
      color: colors.textSecondary,
      fontSize: 15,
      lineHeight: 22,
      textAlign: 'center',
    },
  });
}
