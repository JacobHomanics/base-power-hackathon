import { importGoogleLibrary } from '@/maps/google';

export type AddressSuggestion = {
  id: string;
  label: string;
  title: string;
  detail: string | null;
};

export type LocatedAddress = {
  label: string;
  latitude: number;
  longitude: number;
};

type FormattableText = {
  text: string;
};

type PlacePrediction = {
  placeId: string;
  text: FormattableText;
  mainText?: FormattableText | null;
  secondaryText?: FormattableText | null;
};

type LatLngValue = {
  lat: number | (() => number);
  lng: number | (() => number);
};

type PlaceResult = {
  formattedAddress?: string | null;
  location?: LatLngValue | null;
  fetchFields: (request: { fields: string[] }) => Promise<void>;
};

type PlacesLibrary = {
  Place: new (options: { id: string }) => PlaceResult;
  AutocompleteSessionToken: new () => object;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions: (request: {
      input: string;
      sessionToken: object;
      includedRegionCodes: string[];
      includedPrimaryTypes: string[];
      language: string;
      region: string;
      locationBias: { west: number; south: number; east: number; north: number };
    }) => Promise<{ suggestions: { placePrediction?: PlacePrediction | null }[] }>;
  };
};

let sessionToken: object | null = null;

export function resetAddressSession(): void {
  sessionToken = null;
}

export async function suggestAddresses(input: string): Promise<AddressSuggestion[]> {
  const places = (await importGoogleLibrary('places')) as PlacesLibrary;
  sessionToken ??= new places.AutocompleteSessionToken();
  const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input,
    sessionToken,
    includedRegionCodes: ['us'],
    includedPrimaryTypes: ['street_address', 'premise', 'subpremise', 'route'],
    language: 'en-US',
    region: 'us',
    locationBias: { west: -106.65, south: 25.84, east: -93.51, north: 36.5 },
  });

  const seen = new Set<string>();
  const results: AddressSuggestion[] = [];
  for (const suggestion of suggestions) {
    const prediction = suggestion.placePrediction;
    if (!prediction || seen.has(prediction.placeId)) continue;
    seen.add(prediction.placeId);
    const label = prediction.text.text.trim();
    if (!label) continue;
    const title = prediction.mainText?.text.trim() || label;
    const detail = prediction.secondaryText?.text.trim() || null;
    results.push({
      id: prediction.placeId,
      label,
      title,
      detail: detail && detail !== title ? detail : null,
    });
  }
  return results;
}

export async function locatePlace(placeId: string): Promise<LocatedAddress> {
  const places = (await importGoogleLibrary('places')) as PlacesLibrary;
  const place = new places.Place({ id: placeId });
  await place.fetchFields({ fields: ['formattedAddress', 'location'] });
  const point = readLatLng(place.location);
  if (!point) throw new Error('That address could not be found.');
  return { label: place.formattedAddress?.trim() || '', ...point };
}

export async function locateAddress(input: string): Promise<LocatedAddress> {
  const matches = await suggestAddresses(input);
  const match = matches[0];
  if (!match) throw new Error('That address could not be found.');
  const located = await locatePlace(match.id);
  return { ...located, label: located.label || match.label };
}

function readLatLng(location: LatLngValue | null | undefined): { latitude: number; longitude: number } | null {
  if (!location) return null;
  const latitude = typeof location.lat === 'function' ? location.lat() : location.lat;
  const longitude = typeof location.lng === 'function' ? location.lng() : location.lng;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}
