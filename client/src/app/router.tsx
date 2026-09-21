import { lazy, Suspense } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';

import { Login } from '../screens/Auth/Login';
import { Register } from '../screens/Auth/Register';
import { Lobby } from '../screens/Lobby/Lobby';
import { Profile } from '../screens/Profile/Profile';
import { AppShell } from './AppShell';
import { AuthLayout } from './AuthLayout';
import { NotFound, RouteError } from './errors';
import { MatchFallback } from './MatchFallback';
import { GuestOnly, RequireAuth, RootRedirect, SessionGate } from './guards';

/** La schermata di partita (scacchiera e chess.js) si carica solo quando serve: fuori dal bundle iniziale. */
const Match = lazy(() => import('../screens/Match/Match').then((module) => ({ default: module.Match })));

/**
 * Galleria delle carte (briefing §5.1.9): solo in sviluppo. L'import dinamico sta **dentro** il ramo `DEV`, così la
 * build di produzione lo elimina del tutto invece di produrne un chunk irraggiungibile.
 */
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? (() => {
      const CardGallery = lazy(() => import('../screens/Dev/CardGallery').then((module) => ({ default: module.CardGallery })));
      return [
        {
          path: 'dev/cards',
          element: (
            <Suspense fallback={<MatchFallback />}>
              <CardGallery />
            </Suspense>
          ),
        },
      ];
    })()
  : [];

/** Albero delle rotte: la sessione si valida in `SessionGate` prima di qualunque schermata. */
export const routes: RouteObject[] = [
  {
    element: <SessionGate />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <RootRedirect /> },
      {
        element: <GuestOnly />,
        children: [
          {
            element: <AuthLayout />,
            children: [
              { path: 'login', element: <Login /> },
              { path: 'register', element: <Register /> },
            ],
          },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: 'lobby', element: <Lobby /> },
              { path: 'profile', element: <Profile /> },
            ],
          },
          {
            path: 'match',
            element: (
              <Suspense fallback={<MatchFallback />}>
                <Match />
              </Suspense>
            ),
          },
        ],
      },
      ...devRoutes,
      { path: '*', element: <NotFound /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
