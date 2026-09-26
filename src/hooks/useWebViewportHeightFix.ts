import { useEffect } from 'react';
import { Platform } from 'react-native';

const STYLE_ID = 'base-power-web-viewport';

/**
 * Constrain the web document to the dynamic viewport so absolute-fill overlays
 * are not sized against oversized `100vh` behind browser chrome.
 */
export function useWebViewportHeightFix() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      return;
    }

    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html, body {
        height: 100% !important;
        height: 100dvh !important;
        max-height: 100dvh !important;
        overflow: hidden !important;
        margin: 0 !important;
      }
      #root {
        height: 100% !important;
        height: 100dvh !important;
        max-height: 100dvh !important;
        overflow: hidden !important;
        display: flex !important;
        flex-direction: column !important;
        min-height: 0 !important;
      }
      #root > div {
        flex: 1 1 auto !important;
        min-height: 0 !important;
        display: flex !important;
        flex-direction: column !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.getElementById(STYLE_ID)?.remove();
    };
  }, []);
}
