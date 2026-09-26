import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useWebViewportHeightFix } from '@/hooks/useWebViewportHeightFix';
import { RootNavigator } from '@/navigation/RootNavigator';

export default function App() {
  useWebViewportHeightFix();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <RootNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
