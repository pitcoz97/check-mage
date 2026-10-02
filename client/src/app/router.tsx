import { lazy, Suspense } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';

import { Login } from '../screens/Auth/Login';
import { Collection } from '../screens/Collection/Collection';
import { Decks } from '../screens/Decks/Decks';
import { Friends } from '../screens/Friends/Friends';
import { Register } from '../screens/Auth/Register';
import { LegalPage } from '../legal/LegalPage';
import { Lobby } from '../screens/Lobby/Lobby';
import { Leaderboard } from '../screens/Leaderboard/Leaderboard';
import { PlayerProfile } from '../screens/Player/PlayerProfile';
import { Profile } from '../screens/Profile/Profile';
import { Settings } from '../screens/Settings/Settings';
import { AppShell } from './AppShell';
import { AuthLayout } from './AuthLayout';
import { NotFound, RouteError } from './errors';
import { MatchFallback } from './MatchFallback';
import { GuestOnly, RequireAuth, RootRedirect, SessionGate } from './guards';

/** La schermata di partita (scacchiera e chess.js) si carica solo quando serve: fuori dal bundle iniziale. */
const Match = lazy(() => import('../screens/Match/Match').then((module) => ({ default: module.Match })));

/**
 * Gallerie delle carte (briefing §5.1.9) e della scacchiera, anteprime di partita e home: solo in sviluppo. L'import dinamico sta **dentro** il ramo `DEV`, così la
 * build di produzione lo elimina del tutto invece di produrne un chunk irraggiungibile.
 */
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? (() => {
      const CardGallery = lazy(() => import('../screens/Dev/CardGallery').then((module) => ({ default: module.CardGallery })));
      const BoardGallery = lazy(() => import('../screens/Dev/BoardGallery').then((module) => ({ default: module.BoardGallery })));
      const MatchPreview = lazy(() => import('../screens/Dev/MatchPreview').then((module) => ({ default: module.MatchPreview })));
      const HomePreview = lazy(() => import('../screens/Dev/HomePreview').then((module) => ({ default: module.HomePreview })));
      return [
        {
          path: 'dev/cards',
          element: (
            <Suspense fallback={<MatchFallback />}>
              <CardGallery />
            </Suspense>
          ),
        },
        {
          path: 'dev/board',
          element: (
            <Suspense fallback={<MatchFallback />}>
              <BoardGallery />
            </Suspense>
          ),
        },
        {
          path: 'dev/match',
          element: (
            <Suspense fallback={<MatchFallback />}>
              <MatchPreview />
            </Suspense>
          ),
        },
        {
          path: 'dev/home/*',
          element: (
            <Suspense fallback={<MatchFallback />}>
              <HomePreview />
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
      // Documenti legali (P4): pubblici, con o senza account.
      { path: 'privacy', element: <LegalPage doc="privacy" /> },
      { path: 'terms', element: <LegalPage doc="terms" /> },
      { path: 'account-deletion', element: <LegalPage doc="accountDeletion" /> },
      { path: 'credits', element: <LegalPage doc="credits" /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: 'lobby', element: <Lobby /> },
              { path: 'profile', element: <Profile /> },
              { path: 'leaderboard', element: <Leaderboard /> },
              { path: 'collection', element: <Collection /> },
              { path: 'decks', element: <Decks /> },
              { path: 'decks/:id', element: <Decks /> },
              { path: 'friends', element: <Friends /> },
              { path: 'players/:id', element: <PlayerProfile /> },
              { path: 'settings', element: <Settings /> },
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
