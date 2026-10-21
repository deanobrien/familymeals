// Entry point: expo-router as before, plus the Android home-screen widget's headless task (P3-C, D441). The task must be
// registered at module load: Android starts it when a widget is tapped or refreshed and the app may have no screen open.
import 'expo-router/entry';
import { Platform } from 'react-native';

if (Platform.OS === 'android') {
  const { registerWidgetTaskHandler } = require('react-native-android-widget');
  const { widgetTaskHandler } = require('./src/widget/widgetTaskHandler');
  registerWidgetTaskHandler(widgetTaskHandler);
}
