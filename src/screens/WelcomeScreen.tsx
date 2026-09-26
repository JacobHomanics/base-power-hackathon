import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { armLiveCamera } from '@/camera/live';
import type { AppThemeColors } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';
import type { RootStackParamList } from '@/navigation/types';
import { fetchSetup, startSetup, type SetupState } from '@/score/client';

const IDLE_SETUP: SetupState = {
  status: 'idle',
  loaded: 0,
  total: 0,
  message: '',
};

export function WelcomeScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [setup, setSetup] = useState<SetupState>(IDLE_SETUP);
  const [known, setKnown] = useState(false);
  const [offline, setOffline] = useState<string | null>(null);
  const [watch, setWatch] = useState(0);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const next = await Promise.race([
          fetchSetup(),
          new Promise<SetupState>((_, reject) => {
            setTimeout(() => reject(new Error('timeout')), 4000);
          }),
        ]);
        if (cancelled) return;
        setSetup(next);
        setKnown(true);
        setOffline(null);
        if (next.status === 'downloading' || next.status === 'starting') {
          timer = setTimeout(() => {
            void tick();
          }, 400);
        }
      } catch (error) {
        if (!cancelled) {
          setKnown(true);
          setOffline(
            error instanceof Error && error.message === 'timeout'
              ? 'The photo checker is not responding.'
              : 'The photo checker is not running. Start the app with pnpm web.',
          );
        }
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [watch]);

  const initiate = useCallback(() => {
    if (setup.status === 'downloading' || setup.status === 'starting' || setup.status === 'ready') return;
    setStarting(true);
    setOffline(null);
    void Promise.race([
      startSetup(),
      new Promise<SetupState>((_, reject) => {
        setTimeout(() => reject(new Error('The photo checker is not responding.')), 4000);
      }),
    ])
      .then((next) => {
        setSetup(next);
        setWatch((value) => value + 1);
      })
      .catch((error: unknown) => {
        setOffline(error instanceof Error ? error.message : 'Setup could not start.');
      })
      .finally(() => setStarting(false));
  }, [setup.status]);

  const ready = setup.status === 'ready';
  const busy = setup.status === 'downloading' || setup.status === 'starting' || starting;

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {Platform.OS === 'web' ? (
        <View style={styles.center}>
          {!known ? <ActivityIndicator /> : null}
          {known && ready ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                armLiveCamera();
                navigation.navigate('photos');
              }}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.primaryLabel}>Continue</Text>
            </Pressable>
          ) : null}
          {known && !ready && busy ? (
            <>
              <ActivityIndicator />
              <Text style={styles.note}>Installing necessary components</Text>
            </>
          ) : null}
          {known && !ready && !busy ? (
            <>
              {setup.status === 'error' ? null : (
                <Text style={styles.headline}>Discover Your Eligibility</Text>
              )}
              <Pressable
                accessibilityRole="button"
                onPress={initiate}
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
              >
                <Text style={styles.primaryLabel}>
                  {setup.status === 'error' ? 'Try again' : 'Initiate setup'}
                </Text>
              </Pressable>
            </>
          ) : null}
          {!busy && setup.status === 'error' ? <Text style={styles.error}>{setup.message}</Text> : null}
          {!busy && offline ? <Text style={styles.error}>{offline}</Text> : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('mapDetector')}
            style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
          >
            <Text style={styles.textButtonLabel}>Map detector</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.center}>
          <Text style={styles.note}>Open this page in a browser to set up and take a picture.</Text>
        </View>
      )}
    </View>
  );
}

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
      gap: 16,
    },
    headline: {
      fontSize: 32,
      fontWeight: '700',
      textAlign: 'center',
      color: colors.text,
    },
    note: {
      fontSize: 15,
      lineHeight: 22,
      textAlign: 'center',
      color: colors.textSecondary,
    },
    error: {
      fontSize: 15,
      lineHeight: 22,
      textAlign: 'center',
      color: colors.error,
    },
    primaryButton: {
      backgroundColor: colors.brand,
      borderRadius: 999,
      paddingHorizontal: 28,
      paddingVertical: 16,
    },
    primaryLabel: {
      color: colors.onBrand,
      fontSize: 18,
      fontWeight: '700',
    },
    pressed: {
      opacity: 0.8,
    },
    textButton: {
      marginTop: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    textButtonLabel: {
      color: colors.brandAccent,
      fontSize: 16,
      fontWeight: '600',
    },
  });
}
