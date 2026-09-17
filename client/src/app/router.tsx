import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';

import { Login } from '../screens/Auth/Login';
import { Register } from '../screens/Auth/Register';
import { Lobby } from '../screens/Lobby/Lobby';
import { Match } from '../screens/Match/Match';
import { Profile } from '../screens/Profile/Profile';
import { AppShell } from './AppShell';
import { AuthLayout } from './AuthLayout';
import { NotFound, RouteError } from './errors';

/** Albero delle rotte. Le guardie d'accesso (sessione valida) arrivano allo Step 2. */
export const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/lobby" replace /> },
      {
        element: <AuthLayout />,
        children: [
          { path: 'login', element: <Login /> },
          { path: 'register', element: <Register /> },
        ],
      },
      {
        element: <AppShell />,
        children: [
          { path: 'lobby', element: <Lobby /> },
          { path: 'profile', element: <Profile /> },
        ],
      },
      { path: 'match', element: <Match /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
