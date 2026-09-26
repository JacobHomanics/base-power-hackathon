import type { ComponentType } from 'react';

import {
  ROOT_STACK_INITIAL_ROUTE,
  type RootStackParamList,
} from '@/navigation/types';
import { HomeScreen } from '@/screens/HomeScreen';

export { ROOT_STACK_INITIAL_ROUTE };

export const rootStackScreenTitles = {
  home: 'Find a can',
} as const;

export const rootStackScreens = {
  home: HomeScreen,
} as const satisfies Record<keyof RootStackParamList, ComponentType<object>>;
