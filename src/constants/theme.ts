import type { ColorSchemeName } from 'react-native';

import { APP_BRAND_ACCENT_DARK_HEX, APP_BRAND_HEX } from '@/constants/brand';

export type ResolvedColorScheme = 'light' | 'dark';

export function resolveColorScheme(
  systemScheme: ColorSchemeName | null | undefined,
): ResolvedColorScheme {
  return systemScheme === 'dark' ? 'dark' : 'light';
}

export type AppThemeColors = {
  background: string;
  surface: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  brand: string;
  brandAccent: string;
  onBrand: string;
  positive: string;
  warning: string;
  error: string;
  statusBarStyle: 'light' | 'dark';
};

const LIGHT_THEME: AppThemeColors = {
  background: '#f5f7fb',
  surface: '#ffffff',
  border: '#d8dee8',
  text: '#0a0a0a',
  textSecondary: '#4a5568',
  textMuted: '#8892a4',
  brand: APP_BRAND_HEX,
  brandAccent: APP_BRAND_HEX,
  onBrand: '#ffffff',
  positive: '#067647',
  warning: '#b54708',
  error: '#b42318',
  statusBarStyle: 'dark',
};

const DARK_THEME: AppThemeColors = {
  background: '#0b0f19',
  surface: '#151b28',
  border: '#2a3344',
  text: '#f5f7fb',
  textSecondary: '#c5cddb',
  textMuted: '#8b95a8',
  brand: APP_BRAND_HEX,
  brandAccent: APP_BRAND_ACCENT_DARK_HEX,
  onBrand: '#ffffff',
  positive: '#3ddc97',
  warning: '#f5a524',
  error: '#ff6b6b',
  statusBarStyle: 'light',
};

export function appThemeColors(colorScheme: ResolvedColorScheme): AppThemeColors {
  return colorScheme === 'dark' ? DARK_THEME : LIGHT_THEME;
}
