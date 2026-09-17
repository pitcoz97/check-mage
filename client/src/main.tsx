import './design/fonts';
import './design/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';

import { createAppRouter } from './app/router';
import { initI18n } from './i18n';

const container = document.getElementById('root');
if (container === null) throw new Error('Elemento #root mancante in index.html');

await initI18n();

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={createAppRouter()} />
  </StrictMode>,
);
