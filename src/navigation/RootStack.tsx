import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAppTheme } from '@/hooks/useAppTheme';
import {
  ROOT_STACK_INITIAL_ROUTE,
  rootStackScreenTitles,
  rootStackScreens,
} from '@/navigation/RootStack.shared';
import type { RootStackParamList } from '@/navigation/types';

const NativeStack = createNativeStackNavigator<RootStackParamList>();

export function RootStack() {
  const { colors } = useAppTheme();

  return (
    <NativeStack.Navigator
      initialRouteName={ROOT_STACK_INITIAL_ROUTE}
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: true,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      {(Object.keys(rootStackScreens) as (keyof RootStackParamList)[]).map((name) => (
        <NativeStack.Screen
          key={name}
          name={name}
          component={rootStackScreens[name]}
          options={{ title: rootStackScreenTitles[name] }}
        />
      ))}
    </NativeStack.Navigator>
  );
}
