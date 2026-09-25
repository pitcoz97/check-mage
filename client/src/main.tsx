import './design/fonts';
import './design/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';

import { createAppRouter } from './app/router';
import { boardThemeStore } from './game/board/boardTheme';
import { appEnv } from './config/env';
import { initI18n } from './i18n';
import { consoleSink, setLogSink } from './lib/log';
import { storage } from './lib/storage';
import { initNativeShell, isNative, nativeAppEvents } from './platform/native';
import { createCatalogStore } from './spells/catalog';
import { CatalogProvider } from './spells/CatalogProvider';
import { AuthProvider } from './store/AuthProvider';
import { createAuth } from './store/authStore';
import { createMatchSession } from './store/matchSession';
import { MatchProvider } from './store/MatchProvider';

const container = document.getElementById('root');
if (container === null) throw new Error('Elemento #root mancante in index.html');

// Diagnostica del contratto col server solo in sviluppo; in produzione il log non scrive nulla.
if (import.meta.env.DEV) setLogSink(consoleSink);

// Lingua e tema della scacchiera prima del primo render: niente lampo con i valori di default.
await Promise.all([initI18n(), boardThemeStore.getState().load()]);
const env = appEnv();
const auth = createAuth({ baseUrl: env.apiBaseUrl, storage });
const session = createMatchSession({
  wsBaseUrl: env.wsUrl,
  tickets: auth.api,
  auth: auth.store,
  storage,
  // Su dispositivo il socket muore in background: si riparte alla ripresa (briefing §9).
  appEvents: isNative() ? nativeAppEvents() : null,
});
const catalog = createCatalogStore({ api: auth.api });

createRoot(container).render(
  <StrictMode>
    <AuthProvider auth={auth}>
      <CatalogProvider store={catalog}>
        <MatchProvider session={session}>
          <RouterProvider router={createAppRouter()} />
        </MatchProvider>
      </CatalogProvider>
    </AuthProvider>
  </StrictMode>,
);

// Interfaccia montata: si può togliere lo splash e sistemare la barra di stato (no-op sul web).
void initNativeShell();
