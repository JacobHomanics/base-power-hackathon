import type { LinkingOptions } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import type { RootStackParamList } from '@/navigation/types';

export const APP_SCHEME = 'basepower';

export const APP_ORIGIN =
  process.env.EXPO_PUBLIC_APP_ORIGIN?.replace(/\/$/, '') ?? '';

export function getLinkingPrefixes(): string[] {
  const prefixes = [Linking.createURL('/'), `${APP_SCHEME}://`];

  if (APP_ORIGIN) {
    prefixes.push(APP_ORIGIN);
  }

  return prefixes;
}

export function getAppOrigin(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return APP_ORIGIN || Linking.createURL('/');
}

export const rootLinking: LinkingOptions<RootStackParamList> = {
  prefixes: getLinkingPrefixes(),
  config: {
    screens: {
      welcome: '',
      photos: 'photos',
      mapDetector: 'mapDetector',
    },
  },
};
