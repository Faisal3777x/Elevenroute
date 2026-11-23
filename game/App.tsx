import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Game } from './src/ui/Game';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Game />
    </SafeAreaProvider>
  );
}
