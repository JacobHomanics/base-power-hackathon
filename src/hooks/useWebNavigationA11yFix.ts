import {
  type NavigationContainerRefWithCurrent,
  type ParamListBase,
} from '@react-navigation/native';
import { useEffect } from 'react';
import { Platform } from 'react-native';

function blurActiveElement() {
  if (typeof document === 'undefined') {
    return;
  }

  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) {
    active.blur();
  }
}

/**
 * On web, @react-navigation/stack sets aria-hidden on the previous card while
 * the pressed control still has focus, which triggers a browser a11y warning.
 */
export function useWebNavigationA11yFix(
  navigationRef: NavigationContainerRefWithCurrent<ParamListBase>,
) {
  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }

    return navigationRef.addListener('__unsafe_action__', ({ data }) => {
      if (data.noop) {
        return;
      }

      blurActiveElement();
    });
  }, [navigationRef]);
}
