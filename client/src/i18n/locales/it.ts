/**
 * Risorsa italiana: lingua di default e fonte delle chiavi. `en.ts` deve avere esattamente la stessa forma.
 */
export const it = {
  app: {
    name: 'CheckMage',
    tagline: 'Scacchi, con la magia.',
  },
  nav: {
    main: 'Navigazione principale',
    lobby: 'Gioca',
    profile: 'Profilo',
  },
  language: {
    label: 'Lingua',
    it: 'Italiano',
    en: 'English',
  },
  auth: {
    loginTitle: 'Accedi',
    loginLead: 'Entra con la tua email per giocare.',
    registerTitle: 'Crea un account',
    registerLead: 'Scegli un nome utente e inizia a giocare.',
    toRegister: 'Non hai un account? Registrati',
    toLogin: 'Hai già un account? Accedi',
    comingSoon: 'Il modulo arriverà a breve.',
  },
  lobby: {
    title: 'Pronto a giocare?',
    lead: 'Trova un avversario: la partita inizia appena ne arriva uno.',
    play: 'Gioca',
    playUnavailable: 'La ricerca partita sarà disponibile a breve.',
  },
  profile: {
    title: 'Profilo',
    lead: 'Qui troverai ELO e statistiche delle tue partite.',
  },
  match: {
    board: 'Scacchiera',
    opponent: 'Avversario',
    you: 'Tu',
    phases: 'Fasi del turno',
    history: 'Storico mosse',
    actions: 'Azioni',
    hand: 'Mano',
    showHistory: 'Mostra storico mosse',
  },
  errors: {
    notFoundTitle: 'Pagina non trovata',
    notFoundLead: 'Questa pagina non esiste.',
    backToLobby: 'Torna alla lobby',
    genericTitle: 'Qualcosa è andato storto',
    genericLead: 'Ricarica la pagina per riprovare.',
  },
} as const;

type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** Forma delle traduzioni: stesse chiavi dell'italiano, valori stringa qualsiasi. */
export type Translation = Widen<typeof it>;
