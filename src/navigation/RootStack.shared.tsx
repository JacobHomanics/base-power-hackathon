import type { ComponentType } from 'react';

import {
  ROOT_STACK_INITIAL_ROUTE,
  type RootStackParamList,
} from '@/navigation/types';
import { ErcotScreen } from '@/screens/ErcotScreen';

export { ROOT_STACK_INITIAL_ROUTE };

export const rootStackScreenTitles = {
  home: 'ERCOT',
} as const;

export const rootStackScreens = {
  home: ErcotScreen,
} as const satisfies Record<keyof RootStackParamList, ComponentType<object>>;
