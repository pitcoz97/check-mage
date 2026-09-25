import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Configurazione dell'app nativa (briefing §9).
 *
 * `appId` è immutabile una volta pubblicata sugli store. `androidScheme: 'https'` dà alla WebView l'origine
 * `https://localhost`, che il server accetta già nel CORS (`config/config.go:74-75`).
 *
 * I colori qui sono gli unici duplicati dei token: il lato nativo non legge `src/design/tokens.css`. Sono copie di
 * `--bg-app`; se cambia lì, va cambiato anche qui e in `android/app/src/main/res/values/colors.xml`.
 */
const BACKGROUND = '#1B1A1F'; // --bg-app

const config: CapacitorConfig = {
  appId: 'com.checkmage.app',
  appName: 'CheckMage',
  webDir: 'dist',
  android: {
    backgroundColor: BACKGROUND,
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      // La chiude il client quando l'interfaccia è pronta: niente lampo bianco fra splash e app.
      launchAutoHide: false,
      backgroundColor: BACKGROUND,
    },
    StatusBar: {
      // `DARK` = contenuto chiaro su sfondo scuro, come il resto dell'app.
      style: 'DARK',
      backgroundColor: BACKGROUND,
      overlaysWebView: false,
    },
  },
};

export default config;
