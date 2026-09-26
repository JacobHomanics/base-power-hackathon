import { Platform, useWindowDimensions } from 'react-native';

const DESKTOP_MIN_WIDTH = 768;

/** True on web viewports wide enough for desktop chrome. */
export function useIsDesktopWeb() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_MIN_WIDTH;
}
