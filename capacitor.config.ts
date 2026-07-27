import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.butineur.mobile',
  appName: 'Butineur',
  webDir: 'dist',
  android: {
    // Les widgets lisent le même fichier SharedPreferences que @capacitor/preferences.
    backgroundColor: '#0e0e14',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_bee',
      iconColor: '#4ade80',
    },
  },
}

export default config
