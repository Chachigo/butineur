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
    // L'appli est sombre quel que soit le thème du téléphone. Sans ça, le
    // plugin SystemBars suit le réglage système et repeignait les icônes de la
    // barre d'état en noir — invisibles sur le bandeau sombre du web. Le régler
    // ici plutôt qu'en Java : Capacitor l'applique après `onCreate`, il gagne
    // de toute façon sur le thème comme sur tout appel qu'on ferait avant lui.
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
