/**
 * Confine fra client web e app nativa (briefing §9). È l'unico posto che sa di Capacitor: tutto il resto del client
 * resta identico sulle tre piattaforme.
 *
 * I plugin si caricano con `import()` e solo su dispositivo, così il bundle web non li porta dentro. Il
 * riconoscimento della piattaforma legge il ponte che il runtime nativo inietta nella WebView prima dell'app
 * (`window.Capacitor`), e non richiede `@capacitor/core` sul web.
 */

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
