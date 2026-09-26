import type { ComponentType } from 'react';

import {
  ROOT_STACK_INITIAL_ROUTE,
  type RootStackParamList,
} from '@/navigation/types';
import { CanScreen } from '@/screens/CanScreen';
import { ErcotScreen } from '@/screens/ErcotScreen';
import { MapScreen } from '@/screens/MapScreen';

export { ROOT_STACK_INITIAL_ROUTE };

export const rootStackScreenTitles = {
  home: 'ERCOT',
  map: 'Price map',
  scan: 'Aluminum can',
} as const;

export const rootStackScreens = {
  home: ErcotScreen,
  map: MapScreen,
  scan: CanScreen,
} as const satisfies Record<keyof RootStackParamList, ComponentType<object>>;
