/**
 * Confine fra client web e app nativa (briefing §9). È l'unico posto che sa di Capacitor: tutto il resto del client
 * resta identico sulle tre piattaforme.
 *
 * I plugin si caricano con `import()` e solo su dispositivo, così il bundle web non li porta dentro. Il
 * riconoscimento della piattaforma legge il ponte che il runtime nativo inietta nella WebView prima dell'app
 * (`window.Capacitor`), e non richiede `@capacitor/core` sul web.
 */

import { log as defaultLog, type Logger } from '../lib/log';
import type { AppResumeEvents } from '../store/matchSession';

interface CapacitorBridge {
  isNativePlatform?(): boolean;
}

/** `true` solo dentro la WebView di Android o iOS. */
export function isNative(): boolean {
  const bridge = (globalThis as { Capacitor?: CapacitorBridge }).Capacitor;
  try {
    return bridge?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------
// Ciclo di vita dell'app
// ---------------------------------------------------------------------------------------------------

/** Il poco che serve di `@capacitor/app`: nei test si inietta un finto. */
export interface AppPlugin {
  addListener(
    eventName: 'appStateChange',
    listener: (state: { isActive: boolean }) => void,
  ): Promise<{ remove(): Promise<void> }>;
}

const loadAppPlugin = async (): Promise<AppPlugin> => (await import('@capacitor/app')).App;

/**
 * Ripresa dell'app dal background, nella forma che vuole `matchSession`. La registrazione del listener è asincrona
 * (il plugin si carica a richiesta): se ci si disiscrive prima che sia pronta, il listener viene tolto appena esiste.
 */
export function nativeAppEvents(load: () => Promise<AppPlugin> = loadAppPlugin, log: Logger = defaultLog): AppResumeEvents {
  return {
    subscribe(onResume) {
      let handle: { remove(): Promise<void> } | null = null;
      let cancelled = false;
      void (async () => {
        try {
          const registered = await (await load()).addListener('appStateChange', ({ isActive }) => {
            if (isActive) onResume();
          });
          if (cancelled) void registered.remove();
          else handle = registered;
        } catch (error) {
          log.warn('eventi di ciclo di vita non disponibili', error);
        }
      })();
      return () => {
        cancelled = true;
        void handle?.remove();
        handle = null;
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Aspetto della finestra nativa
// ---------------------------------------------------------------------------------------------------

/**
 * Barra di stato e chiusura dello splash, una volta che l'interfaccia è montata (lo splash non si chiude da solo:
 * `launchAutoHide: false` in `capacitor.config.ts`). Sul web non fa nulla; un plugin che manca non ferma l'avvio.
 */
export async function initNativeShell(log: Logger = defaultLog): Promise<void> {
  if (!isNative()) return;
  try {
    const [statusBar, splashScreen] = await Promise.all([import('@capacitor/status-bar'), import('@capacitor/splash-screen')]);
    // `Dark` = contenuto chiaro su sfondo scuro, come il resto dell'app.
    await statusBar.StatusBar.setStyle({ style: statusBar.Style.Dark });
    await splashScreen.SplashScreen.hide();
  } catch (error) {
    log.warn('shell nativa non inizializzata', error);
  }
}
