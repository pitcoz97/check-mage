// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { initI18n } from '../i18n';
import { createWebStorage } from '../lib/storage';
import { AuthProvider } from '../store/AuthProvider';
import { createAuth } from '../store/authStore';
import { ACCOUNT, data, fail, fakeServer, LOGIN, memoryStorage, type Handler } from '../testing/fakes';
import { routes } from './router';

beforeAll(async () => {
  await initI18n(createWebStorage(() => undefined));
});
afterEach(cleanup);

async function renderApp(path: string, serverRoutes: Record<string, Handler>, session?: object) {
  const { storage, map } = memoryStorage();
  if (session !== undefined) await storage.set('session', JSON.stringify(session));
  const server = fakeServer(serverRoutes);
  const auth = createAuth({ baseUrl: 'http://api', storage, fetchImpl: server.fetchImpl });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider auth={auth}>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return { router, server, map, auth };
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('guardie di rotta', () => {
  it('anonimo su una rotta protetta → login; dopo il login torna alla pagina richiesta', async () => {
    const { router, server } = await renderApp('/profile', {
      'POST /auth/login': () => data(LOGIN),
      'GET /me': () => data(ACCOUNT),
      'GET /users/7': () => data({ user: ACCOUNT, stats: { wins: 3, losses: 1, draws: 2, total: 6 } }),
    });
    expect(await screen.findByRole('heading', { name: 'Accedi' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');

    type('Email', 'mario@test.it');
    type('Password', 'Password1');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accedi' }));
    });
    expect(await screen.findByRole('heading', { name: 'mario' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/profile');
    const wins = document.querySelector('[data-stat="wins"]') as HTMLElement;
    expect(within(wins).getByText('3')).toBeTruthy();
    expect(server.hits).toContain('GET /users/7');
  });

  it('autenticato su /login → lobby', async () => {
    const { router } = await renderApp('/login', { 'GET /me': () => data(ACCOUNT) }, { accessToken: 'a1', refreshToken: 'r1' });
    expect(await screen.findByRole('heading', { name: 'Pronto a giocare?' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/lobby');
    expect(screen.getByText('ELO 1234')).toBeTruthy();
  });

  it('logout → login', async () => {
    const { router, map } = await renderApp('/lobby', { 'GET /me': () => data(ACCOUNT) }, { accessToken: 'a1', refreshToken: 'r1' });
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Esci' }));
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(map.size).toBe(0);
  });

  it('sessione scaduta al bootstrap → login con avviso', async () => {
    await renderApp(
      '/lobby',
      { 'GET /me': () => fail(401, 'Token non valido o scaduto'), 'POST /auth/refresh': () => fail(401, 'Refresh token non valido o scaduto') },
      { accessToken: 'old', refreshToken: 'old' },
    );
    expect(await screen.findByText('La sessione è scaduta: accedi di nuovo.')).toBeTruthy();
  });

  it('server irraggiungibile al bootstrap → pagina con Riprova', async () => {
    const { server } = await renderApp('/lobby', {}, { accessToken: 'a1', refreshToken: 'r1' });
    expect(await screen.findByRole('heading', { name: 'Server non raggiungibile' })).toBeTruthy();
    server.routes['GET /me'] = () => data(ACCOUNT);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    });
    expect(await screen.findByRole('heading', { name: 'Pronto a giocare?' })).toBeTruthy();
  });
});

describe('login', () => {
  it('credenziali errate: messaggio inline tradotto, bottone disabilitato durante l’invio', async () => {
    let release: () => void = () => undefined;
    await renderApp('/login', {
      'POST /auth/login': () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(fail(401, 'Credenziali non valide'));
        }),
    });
    await screen.findByRole('heading', { name: 'Accedi' });
    type('Email', 'mario@test.it');
    type('Password', 'sbagliata');
    const submit = screen.getByRole('button', { name: 'Accedi' }) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(submit);
    });
    expect((screen.getByRole('button', { name: 'Attendi…' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => release());
    expect((await screen.findByRole('alert')).textContent).toBe('Email o password non corretti.');
    expect(screen.queryByText('Credenziali non valide')).toBeNull();
  });
});

describe('registrazione', () => {
  it('requisiti visibili prima del submit (policy di riserva se l’endpoint non risponde), submit abilitato solo quando sono tutti soddisfatti', async () => {
    await renderApp('/register', {});
    await screen.findByRole('heading', { name: 'Crea un account' });
    const submit = screen.getByRole('button', { name: 'Crea account' }) as HTMLButtonElement;
    expect(document.querySelectorAll('[data-check]')).toHaveLength(7);
    expect(submit.disabled).toBe(true);

    type('Nome utente', 'mario');
    type('Email', 'mario@test.it');
    type('Password', 'password1');
    expect(document.querySelector('[data-check="passwordUppercase"]')?.getAttribute('data-met')).toBe('false');
    expect(submit.disabled).toBe(true);

    type('Password', 'Password1');
    expect(document.querySelector('[data-check="passwordUppercase"]')?.getAttribute('data-met')).toBe('true');
    expect(submit.disabled).toBe(false);
  });

  it('login automatico dopo la registrazione', async () => {
    const { router, server } = await renderApp('/register', {
      'POST /auth/register': () => data({ user_id: 7 }),
      'POST /auth/login': () => data(LOGIN),
    });
    await screen.findByRole('heading', { name: 'Crea un account' });
    type('Nome utente', '  mario  ');
    type('Email', 'mario@test.it');
    type('Password', 'Password1');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Crea account' }));
    });
    expect(await screen.findByRole('heading', { name: 'Pronto a giocare?' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/lobby');
    expect(server.hits.filter((hit) => hit !== 'GET /auth/password-policy')).toEqual(['POST /auth/register', 'POST /auth/login']);
  });

  it('i requisiti seguono GET /auth/password-policy', async () => {
    const policy = {
      username: { min_length: 4, max_length: 16, pattern: '^[a-z]+$' },
      password: { min_length: 10, max_length: 64, require_uppercase: false, require_lowercase: true, require_digit: true },
    };
    const { server } = await renderApp('/register', { 'GET /auth/password-policy': () => data(policy) });
    await screen.findByText('Nome utente da 4 a 16 caratteri');
    expect(server.hits).toContain('GET /auth/password-policy');
    expect(screen.getByText('Password da 10 a 64 caratteri')).toBeTruthy();
    expect(document.querySelector('[data-check="passwordUppercase"]')).toBeNull();

    type('Nome utente', 'mario');
    type('Email', 'mario@test.it');
    type('Password', 'password12');
    expect((screen.getByRole('button', { name: 'Crea account' }) as HTMLButtonElement).disabled).toBe(false);
    type('Nome utente', 'mario_1');
    expect(document.querySelector('[data-check="usernameChars"]')?.getAttribute('data-met')).toBe('false');
  });

  it('errori del server sotto il campo giusto o sul form', async () => {
    const replies = [fail(400, 'email non valida'), fail(409, 'Username o email già in uso')];
    await renderApp('/register', { 'POST /auth/register': () => replies.shift() ?? fail(500, 'Errore interno') });
    await screen.findByRole('heading', { name: 'Crea un account' });
    type('Nome utente', 'mario');
    type('Email', 'mario@test.it');
    type('Password', 'Password1');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Crea account' }));
    });
    const emailInput = screen.getByLabelText('Email');
    expect(await screen.findByText('Indirizzo email non valido.')).toBeTruthy();
    expect(emailInput.getAttribute('aria-invalid')).toBe('true');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Crea account' }));
    });
    expect((await screen.findByRole('alert')).textContent).toBe('Nome utente o email già in uso.');
  });

  it('account creato ma login automatico fallito → login con email compilata', async () => {
    const { router } = await renderApp('/register', { 'POST /auth/register': () => data({ user_id: 8 }) });
    await screen.findByRole('heading', { name: 'Crea un account' });
    type('Nome utente', 'luigi');
    type('Email', 'luigi@test.it');
    type('Password', 'Password1');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Crea account' }));
    });
    expect(await screen.findByText('Account creato. Accedi per continuare.')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('luigi@test.it');
  });
});
