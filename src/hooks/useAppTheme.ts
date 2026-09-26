import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { appThemeColors, resolveColorScheme } from '@/constants/theme';

export function useAppTheme() {
  const systemScheme = useColorScheme();
  const colorScheme = resolveColorScheme(systemScheme);
  const colors = useMemo(() => appThemeColors(colorScheme), [colorScheme]);

  return {
    colorScheme,
    colors,
    isDark: colorScheme === 'dark',
  };
}
