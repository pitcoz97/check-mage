import i18next from 'i18next';
import { describe, expect, it } from 'vitest';

import { createWebStorage } from '../lib/storage';
import { changeLanguage, currentLanguage, initI18n } from './index';
import { en } from './locales/en';
import { it as italian } from './locales/it';

function leaves(tree: object, prefix = ''): [string, unknown][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null ? leaves(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]],
  );
}

function memoryStore() {
  const map = new Map<string, string>();
  return createWebStorage(
    () =>
      ({
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
      }) as unknown as Storage,
  );
}

describe('i18n', () => {
  it('italiano e inglese hanno le stesse chiavi e nessun valore vuoto', () => {
    const itKeys = leaves(italian).map(([k]) => k);
    expect(leaves(en).map(([k]) => k)).toEqual(itKeys);
    for (const [key, value] of [...leaves(italian), ...leaves(en)]) {
      expect(typeof value === 'string' && value.trim() !== '', key).toBe(true);
    }
  });

  it('italiano di default, cambio lingua persistito e ripristinato', async () => {
    const store = memoryStore();
    await initI18n(store);
    expect(currentLanguage()).toBe('it');
    expect(i18next.t('lobby.play')).toBe('Gioca');

    await changeLanguage('en', store);
    expect(i18next.t('lobby.play')).toBe('Play');
    expect(await store.get('language')).toBe('en');

    await i18next.changeLanguage('it');
    await initI18n(store);
    expect(currentLanguage()).toBe('en');
  });
});
