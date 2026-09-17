import './design/fonts';
import './design/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';

import { createAppRouter } from './app/router';
import { appEnv } from './config/env';
import { initI18n } from './i18n';
import { storage } from './lib/storage';
import { AuthProvider } from './store/AuthProvider';
import { createAuth } from './store/authStore';

const container = document.getElementById('root');
if (container === null) throw new Error('Elemento #root mancante in index.html');

await initI18n();
const auth = createAuth({ baseUrl: appEnv().apiBaseUrl, storage });

createRoot(container).render(
  <StrictMode>
    <AuthProvider auth={auth}>
      <RouterProvider router={createAppRouter()} />
    </AuthProvider>
  </StrictMode>,
);
