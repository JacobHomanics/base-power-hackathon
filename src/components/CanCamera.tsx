import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { AppThemeColors } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';

export function CanCamera() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Open this page in a browser</Text>
      <Text style={styles.body}>
        The aluminum can check uses the webcam there, then looks through the live frame.
      </Text>
    </View>
  );
}

function createStyles(colors: AppThemeColors) {
  return StyleSheet.create({
    panel: {
      marginTop: 20,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 16,
      borderWidth: 1,
      padding: 16,
    },
    title: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
    },
    body: {
      marginTop: 8,
      color: colors.textSecondary,
      fontSize: 15,
      lineHeight: 22,
    },
  });
}
