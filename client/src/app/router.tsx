import { createBrowserRouter, type RouteObject } from 'react-router';

import { Login } from '../screens/Auth/Login';
import { Register } from '../screens/Auth/Register';
import { Lobby } from '../screens/Lobby/Lobby';
import { Match } from '../screens/Match/Match';
import { Profile } from '../screens/Profile/Profile';
import { AppShell } from './AppShell';
import { AuthLayout } from './AuthLayout';
import { NotFound, RouteError } from './errors';
import { GuestOnly, RequireAuth, RootRedirect, SessionGate } from './guards';

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
          { path: 'match', element: <Match /> },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
