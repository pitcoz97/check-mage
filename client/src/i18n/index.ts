import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { storage, STORAGE_KEYS, type KeyValueStorage } from '../lib/storage';
import { en } from './locales/en';
import { it } from './locales/it';

export const LANGUAGES = ['it', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'it';

export const resources = { it: { translation: it }, en: { translation: en } } as const;

export function isLanguage(value: string | null | undefined): value is Language {
  return LANGUAGES.some((l) => l === value);
}

/**
 * Inizializza i18n. Italiano di default senza auto-detect (briefing §10); se l'utente ha scelto una lingua,
 * la si ripristina dallo storage.
 */
export async function initI18n(store: KeyValueStorage = storage): Promise<typeof i18next> {
  const saved = await store.get(STORAGE_KEYS.language);
  const lng = isLanguage(saved) ? saved : DEFAULT_LANGUAGE;
  await i18next.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...LANGUAGES],
    interpolation: { escapeValue: false }, // React fa già l'escape
    returnNull: false,
  });
  syncDocumentLanguage(lng);
  return i18next;
}

export async function changeLanguage(language: Language, store: KeyValueStorage = storage): Promise<void> {
  await i18next.changeLanguage(language);
  await store.set(STORAGE_KEYS.language, language);
  syncDocumentLanguage(language);
}

export function currentLanguage(): Language {
  const resolved = i18next.resolvedLanguage;
  return isLanguage(resolved) ? resolved : DEFAULT_LANGUAGE;
}

function syncDocumentLanguage(language: Language): void {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}
