import type { Translation } from './it';

/** Risorsa inglese: una chiave mancante o in più rispetto all'italiano non compila. */
export const en: Translation = {
  app: {
    name: 'CheckMage',
    tagline: 'Chess, with magic.',
  },
  nav: {
    main: 'Main navigation',
    lobby: 'Play',
    profile: 'Profile',
  },
  language: {
    label: 'Language',
    it: 'Italiano',
    en: 'English',
  },
  auth: {
    loginTitle: 'Sign in',
    loginLead: 'Sign in with your email to play.',
    registerTitle: 'Create an account',
    registerLead: 'Pick a username and start playing.',
    toRegister: "Don't have an account? Sign up",
    toLogin: 'Already have an account? Sign in',
    comingSoon: 'The form is coming soon.',
  },
  lobby: {
    title: 'Ready to play?',
    lead: 'Find an opponent: the game starts as soon as one joins.',
    play: 'Play',
    playUnavailable: 'Matchmaking will be available soon.',
  },
  profile: {
    title: 'Profile',
    lead: 'Your ELO and game statistics will appear here.',
  },
  match: {
    board: 'Board',
    opponent: 'Opponent',
    you: 'You',
    phases: 'Turn phases',
    history: 'Move history',
    actions: 'Actions',
    hand: 'Hand',
    showHistory: 'Show move history',
  },
  errors: {
    notFoundTitle: 'Page not found',
    notFoundLead: 'This page does not exist.',
    backToLobby: 'Back to the lobby',
    genericTitle: 'Something went wrong',
    genericLead: 'Reload the page to try again.',
  },
};
