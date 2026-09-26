import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';

import { APP_NAME } from '@/constants/brand';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useWebNavigationA11yFix } from '@/hooks/useWebNavigationA11yFix';
import { rootLinking } from '@/navigation/linking';
import { RootStack } from '@/navigation/RootStack';
import type { RootStackParamList } from '@/navigation/types';

export function RootNavigator() {
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const { colors, isDark } = useAppTheme();
  useWebNavigationA11yFix(navigationRef);

  const navigationTheme = useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: isDark,
      colors: {
        ...base.colors,
        primary: colors.brandAccent,
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        notification: colors.error,
      },
    };
  }, [colors, isDark]);

  return (
    <NavigationContainer
      ref={navigationRef}
      linking={rootLinking}
      theme={navigationTheme}
      documentTitle={{
        formatter: (options) =>
          options?.title && options.title !== APP_NAME
            ? `${options.title} · ${APP_NAME}`
            : APP_NAME,
      }}
    >
      <RootStack />
      <StatusBar style={colors.statusBarStyle} />
    </NavigationContainer>
  );
}
