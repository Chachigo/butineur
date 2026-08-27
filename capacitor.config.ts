import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.butineur.mobile',
  appName: 'Butineur',
  webDir: 'dist',
  android: {
    // The widgets read the same SharedPreferences file @capacitor/preferences writes.
    backgroundColor: '#0e0e14',
  },
  plugins: {
    // The app is dark whatever the phone's theme. Without this, the SystemBars
    // plugin follows the system setting and repainted the status bar icons
    // black — invisible on the web view's dark header. Set here rather than in
    // Java: Capacitor applies it after `onCreate`, so it wins over the theme
    // and over any call we could make before it.
    SystemBars: {
      style: 'DARK',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_bee',
      iconColor: '#4ade80',
    },
  },
}

export default config
