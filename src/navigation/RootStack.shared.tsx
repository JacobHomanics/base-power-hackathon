import type { ComponentType } from 'react';

import { APP_NAME } from '@/constants/brand';
import {
  ROOT_STACK_INITIAL_ROUTE,
  type RootStackParamList,
} from '@/navigation/types';
import { HomeScreen } from '@/screens/HomeScreen';

export { ROOT_STACK_INITIAL_ROUTE };

export const rootStackScreenTitles = {
  home: APP_NAME,
} as const;

export const rootStackScreens = {
  home: HomeScreen,
} as const satisfies Record<keyof RootStackParamList, ComponentType<object>>;
