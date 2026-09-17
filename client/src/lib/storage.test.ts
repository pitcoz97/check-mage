import { describe, expect, it } from 'vitest';

import { createWebStorage } from './storage';

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

describe('storage', () => {
  it('legge, scrive e rimuove con un prefisso di namespace', async () => {
    const backend = new MemoryStorage();
    const storage = createWebStorage(() => backend);
    expect(await storage.get('language')).toBeNull();
    await storage.set('language', 'en');
    expect(await storage.get('language')).toBe('en');
    expect(backend.getItem('checkmage:language')).toBe('en');
    await storage.remove('language');
    expect(await storage.get('language')).toBeNull();
  });

  it('uno storage bloccato o assente non rompe nulla', async () => {
    const throwing = createWebStorage(() => {
      throw new Error('SecurityError');
    });
    await expect(throwing.set('k', 'v')).resolves.toBeUndefined();
    await expect(throwing.get('k')).resolves.toBeNull();
    const missing = createWebStorage(() => undefined);
    await expect(missing.get('k')).resolves.toBeNull();
  });
});
