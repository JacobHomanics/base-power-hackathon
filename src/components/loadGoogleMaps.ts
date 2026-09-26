const SCRIPT_ID = 'ercot-google-maps';

type MapsNamespace = NonNullable<Window['google']>['maps'];

declare global {
  interface Window {
    google?: {
      maps: {
        Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMap;
        Polygon: new (options: Record<string, unknown>) => GoogleOverlay;
        Marker: new (options: Record<string, unknown>) => GoogleOverlay;
        InfoWindow: new () => GoogleInfoWindow;
        LatLngBounds: new () => GoogleBounds;
        SymbolPath: { CIRCLE: number };
        event: {
          clearInstanceListeners: (overlay: GoogleOverlay) => void;
        };
      };
    };
    gm_authFailure?: () => void;
  }
}

export type GoogleMap = {
  fitBounds: (bounds: GoogleBounds, padding?: number | Record<string, number>) => void;
  getZoom: () => number | undefined;
  setZoom: (zoom: number) => void;
  setOptions: (options: Record<string, unknown>) => void;
};

export type GoogleOverlay = {
  setMap: (map: GoogleMap | null) => void;
  addListener: (event: string, handler: () => void) => void;
};

export type GoogleInfoWindow = {
  close: () => void;
  open: (options: { map: GoogleMap; anchor?: GoogleOverlay }) => void;
  setContent: (content: HTMLElement) => void;
  setPosition: (position: { lat: number; lng: number }) => void;
};

type GoogleBounds = {
  extend: (point: { lat: number; lng: number }) => void;
};

let loader: Promise<MapsNamespace> | null = null;

export function loadGoogleMaps(apiKey: string): Promise<MapsNamespace> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps loads in the browser.'));
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }

  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const finish = () => {
        if (window.google?.maps) {
          resolve(window.google.maps);
          return;
        }
        reject(new Error('Google Maps did not initialize.'));
      };
      const fail = () => {
        loader = null;
        reject(new Error('Could not load Google Maps.'));
      };
      const existing = document.getElementById(SCRIPT_ID);
      if (existing) {
        existing.addEventListener('load', finish);
        existing.addEventListener('error', fail);
        return;
      }

      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.async = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
      script.onload = finish;
      script.onerror = fail;
      document.head.appendChild(script);
    });
  }

  return loader;
}
