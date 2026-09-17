// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { changeLanguage, initI18n } from '../i18n';
import { createWebStorage } from '../lib/storage';
import { routes } from './router';

const store = createWebStorage(() => undefined);

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  return { router, view };
}

beforeAll(async () => {
  await initI18n(store);
});

afterEach(async () => {
  cleanup();
  await changeLanguage('it', store);
});

describe('router e layout shell', () => {
  it('/ porta alla lobby con testi tradotti', async () => {
    const { router } = renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Pronto a giocare?' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/lobby');
    const play = screen.getByRole('button', { name: 'Gioca' });
    expect((play as HTMLButtonElement).disabled).toBe(true);
  });

  it('rotta sconosciuta → 404', async () => {
    renderAt('/non-esiste');
    expect(await screen.findByRole('heading', { name: 'Pagina non trovata' })).toBeTruthy();
  });

  it('il cambio lingua aggiorna i testi', async () => {
    renderAt('/lobby');
    const select = await screen.findByRole('combobox', { name: 'Lingua' });
    await act(async () => {
      fireEvent.change(select, { target: { value: 'en' } });
    });
    expect(await screen.findByRole('heading', { name: 'Ready to play?' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
  });

  it('/match mostra tutte le regioni del layout', async () => {
    const { view } = renderAt('/match');
    expect(await screen.findByRole('img', { name: 'Scacchiera' })).toBeTruthy();
    for (const region of ['opponent', 'board', 'side', 'self', 'hand', 'phases-mobile']) {
      expect(view.container.querySelector(`[data-region="${region}"]`), region).not.toBeNull();
    }
    expect(view.container.querySelectorAll('[data-region="board"] .grid > div')).toHaveLength(64);
  });

  it('login e registrazione si collegano a vicenda', async () => {
    renderAt('/login');
    fireEvent.click(await screen.findByRole('link', { name: 'Non hai un account? Registrati' }));
    expect(await screen.findByRole('heading', { name: 'Crea un account' })).toBeTruthy();
  });
});
