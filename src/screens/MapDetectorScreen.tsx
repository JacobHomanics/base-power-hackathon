import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  locateAddress,
  locatePlace,
  resetAddressSession,
  suggestAddresses,
  type AddressSuggestion,
} from '@/address/suggest';
import type { AppThemeColors } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { importGoogleLibrary } from '@/maps/google';

const HOUSE_ZOOM = 19;
const BREAKER_COLOR = '#0052FF';
const METER_COLOR = '#F59E0B';

type LatLng = { latitude: number; longitude: number };
type Target = 'breaker' | 'meter';

export function MapDetectorScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const [target, setTarget] = useState<(LatLng & { label: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const lookupRef = useRef(0);
  const [breaker, setBreaker] = useState<LatLng | null>(null);
  const [meter, setMeter] = useState<LatLng | null>(null);
  const [placing, setPlacing] = useState<Target | null>('breaker');
  const meterRef = useRef(meter);
  meterRef.current = meter;

  const submit = (nextValue?: string, placeId?: string) => {
    const next = (typeof nextValue === 'string' ? nextValue : draft).trim();
    if (!next) {
      setError('Enter an address to open the map.');
      return;
    }
    if (!placeId && target?.label === next && !error) return;
    const lookupId = ++lookupRef.current;
    setError(null);
    setLocating(true);
    void (placeId ? locatePlace(placeId) : locateAddress(next))
      .then((found) => {
        if (lookupId !== lookupRef.current) return;
        const label = found.label || next;
        setDraft(label);
        setBreaker(null);
        setMeter(null);
        setPlacing('breaker');
        setTarget({ label, latitude: found.latitude, longitude: found.longitude });
      })
      .catch(() => {
        if (lookupId !== lookupRef.current) return;
        setLocating(false);
        setError('That address could not be found.');
      });
  };

  const place = (target: Target, point: LatLng) => {
    if (target === 'breaker') {
      setBreaker(point);
      setPlacing((current) => {
        if (current !== 'breaker') return current;
        return meterRef.current ? null : 'meter';
      });
      return;
    }
    setMeter(point);
    setPlacing((current) => (current === 'meter' ? null : current));
  };

  if (Platform.OS !== 'web') {
    return (
      <View style={[styles.screen, styles.center, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.note}>Open this page in a browser to look up an address on the map.</Text>
      </View>
    );
  }

  const field = (grow: boolean) => (
    <AddressField
      colors={colors}
      grow={grow}
      onChangeText={(value) => {
        setDraft(value);
        if (error) setError(null);
      }}
      onCommit={(value, placeId) => submit(value, placeId)}
      styles={styles}
      value={draft}
    />
  );

  if (!target) {
    return (
      <View style={[styles.screen, styles.center, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.headline}>Enter an address</Text>
        <Text style={styles.note}>Google Maps will zoom to that place. Then mark the breaker and the meter.</Text>
        <View style={styles.promptField}>{field(false)}</View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={locating}
          onPress={() => submit()}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, locating && styles.disabled]}
        >
          <Text style={styles.primaryLabel}>{locating ? 'Finding that address…' : 'Show map'}</Text>
        </Pressable>
      </View>
    );
  }

  const prompt = error
    ? null
    : locating
      ? 'Finding that address…'
      : placing === 'breaker'
        ? 'Tap where the breaker is.'
        : placing === 'meter'
          ? 'Tap where the meter is.'
          : 'Breaker and meter are marked. Choose one to move it.';

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        {field(true)}
        <Pressable
          accessibilityRole="button"
          onPress={() => submit()}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.primaryLabel}>Update</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {prompt ? <Text style={styles.prompt}>{prompt}</Text> : null}
      <View style={styles.targets}>
        <TargetChip
          active={placing === 'breaker'}
          color={BREAKER_COLOR}
          disabled={locating || !!error}
          label="Breaker"
          marked={breaker !== null}
          onPress={() => setPlacing('breaker')}
          styles={styles}
        />
        <TargetChip
          active={placing === 'meter'}
          color={METER_COLOR}
          disabled={locating || !!error}
          label="Meter"
          marked={meter !== null}
          onPress={() => setPlacing('meter')}
          styles={styles}
        />
      </View>
      <PropertyMap
        address={target.label}
        breaker={breaker}
        latitude={target.latitude}
        longitude={target.longitude}
        meter={meter}
        onError={(message) => {
          setLocating(false);
          setError(message);
        }}
        onLocated={() => setLocating(false)}
        onPlace={place}
        placing={placing}
      />
    </View>
  );
}

function AddressField({
  value,
  onChangeText,
  onCommit,
  grow,
  colors,
  styles,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onCommit: (value?: string, placeId?: string) => void;
  grow: boolean;
  colors: AppThemeColors;
  styles: ReturnType<typeof createStyles>;
}) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const focused = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const skipQuery = useRef<string | null>(null);
  const requestId = useRef(0);

  const isFieldFocused = () => {
    if (focused.current) return true;
    const node = inputRef.current as unknown as HTMLElement | null;
    const active = !!node && (document.activeElement === node || node.contains(document.activeElement));
    if (active) focused.current = true;
    return active;
  };

  useEffect(() => {
    const query = value.trim();
    if (skipQuery.current === value) {
      skipQuery.current = null;
      return;
    }
    if (query.length < 3) {
      requestId.current += 1;
      setSuggestions([]);
      setNotice(null);
      setOpen(false);
      if (query.length === 0) resetAddressSession();
      return;
    }

    const id = ++requestId.current;
    const timer = setTimeout(() => {
      void suggestAddresses(query)
        .then((next) => {
          if (id !== requestId.current) return;
          setSuggestions(next);
          setActive(0);
          setNotice(next.length === 0 ? 'No matching addresses.' : null);
          setOpen(isFieldFocused());
        })
        .catch(() => {
          if (id !== requestId.current) return;
          setSuggestions([]);
          setNotice('Address suggestions are unavailable.');
          setOpen(isFieldFocused());
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [value]);

  const onKeyPress = (event: { nativeEvent: { key: string }; preventDefault?: () => void }) => {
    if (!open) return;
    const key = event.nativeEvent.key;
    if (key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault?.();
      setActive((index) => Math.min(suggestions.length - 1, index + 1));
    } else if (key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault?.();
      setActive((index) => Math.max(0, index - 1));
    } else if (key === 'Escape') {
      event.preventDefault?.();
      setOpen(false);
    }
  };

  const choose = (suggestion: AddressSuggestion) => {
    skipQuery.current = suggestion.label;
    requestId.current += 1;
    resetAddressSession();
    setSuggestions([]);
    setNotice(null);
    setOpen(false);
    onChangeText(suggestion.label);
    onCommit(suggestion.label, suggestion.id);
  };

  const showList = open && (suggestions.length > 0 || notice !== null);

  return (
    <View style={[styles.field, grow ? styles.fieldGrow : styles.fieldFull]}>
      <TextInput
        ref={inputRef}
        accessibilityLabel="Address"
        autoCapitalize="words"
        autoComplete="off"
        autoCorrect={false}
        onBlur={() => {
          focused.current = false;
          setTimeout(() => {
            if (!focused.current) setOpen(false);
          }, 200);
        }}
        onChangeText={onChangeText}
        onFocus={() => {
          focused.current = true;
          if (suggestions.length > 0 || notice) setOpen(true);
        }}
        onKeyPress={onKeyPress}
        onSubmitEditing={() => {
          const highlighted = open ? suggestions[active] : undefined;
          if (highlighted) {
            choose(highlighted);
            return;
          }
          setOpen(false);
          onCommit();
        }}
        placeholder="Street, city, state"
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        style={styles.input}
        value={value}
      />
      {showList ? (
        <View style={styles.suggestions}>
          {suggestions.map((suggestion, index) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: index === active }}
              key={suggestion.id}
              onHoverIn={() => setActive(index)}
              onPress={() => choose(suggestion)}
              style={[styles.suggestion, index === active && { backgroundColor: colors.background }]}
            >
              <Text style={styles.suggestionTitle}>{suggestion.title}</Text>
              {suggestion.detail ? <Text style={styles.suggestionDetail}>{suggestion.detail}</Text> : null}
            </Pressable>
          ))}
          {suggestions.length === 0 && notice ? <Text style={styles.suggestionNotice}>{notice}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function TargetChip({
  label,
  color,
  active,
  marked,
  disabled,
  onPress,
  styles,
}: {
  label: string;
  color: string;
  active: boolean;
  marked: boolean;
  disabled: boolean;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
        {marked ? `${label} marked` : label}
      </Text>
    </Pressable>
  );
}

function PropertyMap({
  address,
  latitude,
  longitude,
  breaker,
  meter,
  placing,
  onPlace,
  onLocated,
  onError,
}: {
  address: string;
  latitude: number;
  longitude: number;
  breaker: LatLng | null;
  meter: LatLng | null;
  placing: Target | null;
  onPlace: (target: Target, point: LatLng) => void;
  onLocated: () => void;
  onError: (message: string) => void;
}) {
  const hostRef = useRef<View>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const markersRef = useRef<{ breaker: GoogleMarker | null; meter: GoogleMarker | null }>({
    breaker: null,
    meter: null,
  });
  const placingRef = useRef(placing);
  const onPlaceRef = useRef(onPlace);
  const onLocatedRef = useRef(onLocated);
  const onErrorRef = useRef(onError);
  const [readyAddress, setReadyAddress] = useState<string | null>(null);
  placingRef.current = placing;
  onPlaceRef.current = onPlace;
  onLocatedRef.current = onLocated;
  onErrorRef.current = onError;

  useEffect(() => {
    const node = hostRef.current as unknown as HTMLElement | null;
    if (!node) return;
    let cancelled = false;
    let listener: { remove(): void } | null = null;

    void (async () => {
      try {
        await loadGoogleMaps();
        if (cancelled) return;
        const canvas = document.createElement('div');
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        node.replaceChildren(canvas);
        const maps = mapsNamespace();
        const map = new maps.Map(canvas, {
          center: { lat: latitude, lng: longitude },
          zoom: HOUSE_ZOOM,
          mapTypeId: 'roadmap',
          clickableIcons: false,
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: false,
          gestureHandling: 'greedy',
        });
        mapRef.current = map;
        listener = map.addListener('click', (event) => {
          const target = placingRef.current;
          if (!target || !event.latLng) return;
          onPlaceRef.current(target, {
            latitude: event.latLng.lat(),
            longitude: event.latLng.lng(),
          });
        });
        if (!cancelled) {
          setReadyAddress(address);
          onLocatedRef.current();
        }
      } catch (caught) {
        if (!cancelled) {
          onErrorRef.current(caught instanceof Error ? caught.message : 'That address could not be found.');
        }
      }
    })();

    return () => {
      cancelled = true;
      listener?.remove();
      markersRef.current.breaker?.setMap(null);
      markersRef.current.meter?.setMap(null);
      markersRef.current = { breaker: null, meter: null };
      mapRef.current = null;
      node.replaceChildren();
      setReadyAddress(null);
    };
  }, [address, latitude, longitude]);

  useEffect(() => {
    mapRef.current?.setOptions({ draggableCursor: placing ? 'crosshair' : undefined });
  }, [placing, readyAddress]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || readyAddress !== address) return;
    upsertMarker(map, markersRef.current, 'breaker', breaker, BREAKER_COLOR, (point) => {
      onPlaceRef.current('breaker', point);
    });
    upsertMarker(map, markersRef.current, 'meter', meter, METER_COLOR, (point) => {
      onPlaceRef.current('meter', point);
    });
  }, [address, breaker, meter, readyAddress]);

  return <View ref={hostRef} style={mapStyle} />;
}

function upsertMarker(
  map: GoogleMap,
  markers: { breaker: GoogleMarker | null; meter: GoogleMarker | null },
  kind: Target,
  point: LatLng | null,
  color: string,
  onMove: (point: LatLng) => void,
) {
  const current = markers[kind];
  if (!point) {
    current?.setMap(null);
    markers[kind] = null;
    return;
  }
  const position = { lat: point.latitude, lng: point.longitude };
  if (current) {
    current.setPosition(position);
    return;
  }
  const Marker = mapsNamespace().Marker;
  const marker = new Marker({
    map,
    position,
    draggable: true,
    title: kind === 'breaker' ? 'Breaker' : 'Meter',
    zIndex: kind === 'breaker' ? 1 : 2,
    label: {
      text: kind === 'breaker' ? 'B' : 'M',
      color: '#ffffff',
      fontSize: '13px',
      fontWeight: '700',
    },
    icon: {
      path: 0,
      scale: 16,
      fillColor: color,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
    },
  });
  marker.addListener('dragend', () => {
    const next = marker.getPosition();
    if (!next) return;
    onMove({ latitude: next.lat(), longitude: next.lng() });
  });
  markers[kind] = marker;
}

function loadGoogleMaps(): Promise<void> {
  return importGoogleLibrary('maps').then(() => undefined);
}

function mapsNamespace(): GoogleNamespace {
  const google = (window as unknown as { google?: { maps?: GoogleNamespace } }).google;
  if (!google?.maps?.Map || !google.maps.Marker) throw new Error('Google Maps failed to load.');
  return google.maps;
}

type GoogleNamespace = {
  Map: new (element: HTMLElement, options: GoogleMapOptions) => GoogleMap;
  Marker: new (options: GoogleMarkerOptions) => GoogleMarker;
};

type GoogleMapOptions = {
  center: { lat: number; lng: number };
  zoom: number;
  mapTypeId: string;
  clickableIcons: boolean;
  streetViewControl: boolean;
  fullscreenControl: boolean;
  mapTypeControl: boolean;
  gestureHandling: string;
};

type GoogleMap = {
  addListener(
    name: 'click',
    handler: (event: { latLng: { lat(): number; lng(): number } | null }) => void,
  ): { remove(): void };
  setOptions(options: { draggableCursor?: string }): void;
};

type GoogleMarkerOptions = {
  map: GoogleMap;
  position: { lat: number; lng: number };
  draggable: boolean;
  title: string;
  zIndex: number;
  label: { text: string; color: string; fontSize: string; fontWeight: string };
  icon: {
    path: number;
    scale: number;
    fillColor: string;
    fillOpacity: number;
    strokeColor: string;
    strokeWeight: number;
  };
};

type GoogleMarker = {
  setMap(map: GoogleMap | null): void;
  setPosition(position: { lat: number; lng: number }): void;
  getPosition(): { lat(): number; lng(): number } | null | undefined;
  addListener(name: 'dragend', handler: () => void): void;
};

const mapStyle = { flex: 1, minHeight: 0, width: '100%' } as const;

function createStyles(colors: AppThemeColors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      gap: 12,
    },
    headline: {
      fontSize: 32,
      fontWeight: '700',
      textAlign: 'center',
      color: colors.text,
    },
    note: {
      fontSize: 16,
      lineHeight: 24,
      textAlign: 'center',
      color: colors.textSecondary,
      maxWidth: 420,
    },
    error: {
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
      color: colors.error,
      paddingHorizontal: 16,
    },
    prompt: {
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '600',
      color: colors.text,
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    promptField: {
      width: '100%',
      maxWidth: 480,
      zIndex: 2,
    },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 12,
      zIndex: 2,
    },
    field: {
      position: 'relative',
      minWidth: 0,
      zIndex: 2,
    },
    fieldFull: {
      width: '100%',
    },
    fieldGrow: {
      flex: 1,
    },
    suggestions: {
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      marginTop: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
      zIndex: 3,
      shadowColor: '#000000',
      shadowOpacity: 0.12,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
    suggestion: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 2,
    },
    suggestionTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    suggestionDetail: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
    suggestionNotice: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    targets: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    chipActive: {
      backgroundColor: colors.brand,
      borderColor: colors.brand,
    },
    chipLabel: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
    },
    chipLabelActive: {
      color: colors.onBrand,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 999,
    },
    input: {
      width: '100%',
      minWidth: 0,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      backgroundColor: colors.surface,
      color: colors.text,
      fontSize: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    primaryButton: {
      backgroundColor: colors.brand,
      borderRadius: 999,
      paddingHorizontal: 18,
      paddingVertical: 12,
    },
    primaryLabel: {
      color: colors.onBrand,
      fontSize: 15,
      fontWeight: '700',
    },
    pressed: {
      opacity: 0.8,
    },
    disabled: {
      opacity: 0.5,
    },
  });
}
