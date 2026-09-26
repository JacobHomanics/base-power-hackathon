import { Platform } from 'react-native';
import { createStackNavigator } from '@react-navigation/stack';

import { useAppTheme } from '@/hooks/useAppTheme';
import { useIsDesktopWeb } from '@/hooks/useIsDesktopWeb';
import {
  ROOT_STACK_INITIAL_ROUTE,
  rootStackScreenTitles,
  rootStackScreens,
} from '@/navigation/RootStack.shared';
import type { RootStackParamList } from '@/navigation/types';

const WebStack = createStackNavigator<RootStackParamList>();

export function RootStack() {
  const isDesktopWeb = useIsDesktopWeb();
  const { colors } = useAppTheme();

  return (
    <WebStack.Navigator
      initialRouteName={ROOT_STACK_INITIAL_ROUTE}
      screenOptions={{
        headerShown: false,
        animation: isDesktopWeb ? 'none' : 'slide_from_right',
        cardStyle:
          Platform.OS === 'web'
            ? { flex: 1, backgroundColor: colors.background }
            : { backgroundColor: colors.background },
      }}
    >
      {(Object.keys(rootStackScreens) as (keyof RootStackParamList)[]).map((name) => (
        <WebStack.Screen
          key={name}
          name={name}
          component={rootStackScreens[name]}
          options={{ title: rootStackScreenTitles[name] }}
        />
      ))}
    </WebStack.Navigator>
  );
}
