import './design/fonts';
import './design/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';

import { createAppRouter } from './app/router';
import { appEnv } from './config/env';
import { initI18n } from './i18n';
import { consoleSink, setLogSink } from './lib/log';
import { storage } from './lib/storage';
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

await initI18n();
const env = appEnv();
const auth = createAuth({ baseUrl: env.apiBaseUrl, storage });
const session = createMatchSession({ wsBaseUrl: env.wsUrl, tickets: auth.api, auth: auth.store, storage });
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
