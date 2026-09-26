import type { ComponentType } from 'react';

import {
  ROOT_STACK_INITIAL_ROUTE,
  type RootStackParamList,
} from '@/navigation/types';
import { HomeScreen } from '@/screens/HomeScreen';
import { MapDetectorScreen } from '@/screens/MapDetectorScreen';
import { WelcomeScreen } from '@/screens/WelcomeScreen';

export { ROOT_STACK_INITIAL_ROUTE };

export const rootStackScreenTitles = {
  welcome: 'Welcome',
  photos: 'Take a picture',
  mapDetector: 'Map detector',
} as const;

export const rootStackScreens = {
  welcome: WelcomeScreen,
  photos: HomeScreen,
  mapDetector: MapDetectorScreen,
} as const satisfies Record<keyof RootStackParamList, ComponentType<object>>;
