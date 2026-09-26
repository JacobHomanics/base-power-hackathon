import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CanCamera } from '@/components/CanCamera';
import { ScreenHeader } from '@/components/ScreenHeader';
import type { AppThemeColors } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';
import type { RootStackParamList } from '@/navigation/types';

export function CanScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
        },
      ]}
    >
      <View style={styles.column}>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            navigation.navigate('home');
          }}
        >
          <Text style={styles.back}>ERCOT</Text>
        </Pressable>
        <ScreenHeader
          showBrand={false}
          subtitle="Live webcam. The page checks whether an aluminum can is in the frame."
          title="Aluminum can"
        />
        <CanCamera />
      </View>
    </View>
  );
}

function createStyles(colors: AppThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
      paddingHorizontal: 24,
    },
    column: {
      flex: 1,
      width: '100%',
      maxWidth: 960,
      alignSelf: 'center',
    },
    back: {
      color: colors.brandAccent,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.4,
    },
  });
}
