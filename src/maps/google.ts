type MapsNamespace = {
  importLibrary?: (name: string) => Promise<Record<string, unknown>>;
  __ib__?: () => void;
};

type GoogleWindow = Window & {
  google?: {
    maps?: MapsNamespace;
  };
};

export function ensureGoogleMapsLoader(apiKey: string): void {
  const host = window as GoogleWindow;
  if (host.google?.maps?.importLibrary) return;

  const google = (host.google ??= {});
  const maps: MapsNamespace = (google.maps ??= {});
  const pending = new Set<string>();
  let scriptPromise: Promise<void> | undefined;

  const loadScript = () => {
    scriptPromise ??= new Promise<void>((resolve, reject) => {
      const params = new URLSearchParams({
        v: 'weekly',
        key: apiKey,
        libraries: [...pending].join(','),
        callback: 'google.maps.__ib__',
      });
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
      script.onerror = () => {
        scriptPromise = undefined;
        reject(new Error('Google Maps failed to load.'));
      };
      maps.__ib__ = () => resolve();
      document.head.append(script);
    });
    return scriptPromise;
  };

  const localImport = (name: string) => {
    pending.add(name);
    return loadScript().then(() => {
      const importer = host.google?.maps?.importLibrary;
      if (!importer || importer === localImport) {
        throw new Error('Google Maps failed to load.');
      }
      return importer(name);
    });
  };

  maps.importLibrary = localImport;
}

export async function importGoogleLibrary(name: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
  if (!apiKey) throw new Error('Google Maps is not configured.');
  ensureGoogleMapsLoader(apiKey);
  const importer = (window as GoogleWindow).google?.maps?.importLibrary;
  if (!importer) throw new Error('Google Maps failed to load.');
  return importer(name);
}
