// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { changeLanguage, initI18n } from '../i18n';
import { createWebStorage } from '../lib/storage';
import { AuthProvider } from '../store/AuthProvider';
import { createAuth } from '../store/authStore';
import { ACCOUNT, data, fakeServer, memoryStorage } from '../testing/fakes';
import { routes } from './router';

const languageStore = createWebStorage(() => undefined);

/** Utente già autenticato: sessione salvata e `/me` valido. */
async function renderAuthenticated(path: string) {
  const { storage } = memoryStorage();
  await storage.set('session', JSON.stringify({ accessToken: 'a1', refreshToken: 'r1' }));
  const server = fakeServer({ 'GET /me': () => data(ACCOUNT), 'GET /users/7': () => data({ user: ACCOUNT, stats: { wins: 1, losses: 0, draws: 0, total: 1 } }) });
  const auth = createAuth({ baseUrl: 'http://api', storage, fetchImpl: server.fetchImpl });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <AuthProvider auth={auth}>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return { router, view };
}

beforeAll(async () => {
  await initI18n(languageStore);
});

afterEach(async () => {
  cleanup();
  await changeLanguage('it', languageStore);
});

describe('router e layout shell', () => {
  it('/ porta alla lobby con testi tradotti', async () => {
    const { router } = await renderAuthenticated('/');
    expect(await screen.findByRole('heading', { name: 'Pronto a giocare?' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/lobby');
    expect((screen.getByRole('button', { name: 'Gioca' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('rotta sconosciuta → 404', async () => {
    await renderAuthenticated('/non-esiste');
    expect(await screen.findByRole('heading', { name: 'Pagina non trovata' })).toBeTruthy();
  });

  it('il cambio lingua aggiorna i testi', async () => {
    await renderAuthenticated('/lobby');
    const select = await screen.findByRole('combobox', { name: 'Lingua' });
    await act(async () => {
      fireEvent.change(select, { target: { value: 'en' } });
    });
    expect(await screen.findByRole('heading', { name: 'Ready to play?' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
  });

  it('/match mostra tutte le regioni del layout', async () => {
    const { view } = await renderAuthenticated('/match');
    expect(await screen.findByRole('img', { name: 'Scacchiera' })).toBeTruthy();
    for (const region of ['opponent', 'board', 'side', 'self', 'hand', 'phases-mobile']) {
      expect(view.container.querySelector(`[data-region="${region}"]`), region).not.toBeNull();
    }
    expect(view.container.querySelectorAll('[data-region="board"] .grid > div')).toHaveLength(64);
  });
});
