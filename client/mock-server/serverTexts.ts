/**
 * Errori esatti prodotti da chess-server (branch `fix/backend-requests`), copiati dal codice Go.
 *
 * Il mock NON importa nulla dall'adapter del client: se i due divergono, `tests/error-texts.test.ts`
 * se ne accorge.
 */

/** Codici di `gameerr/gameerr.go:17-49`. */
export const GAME_ERROR_CODES = [
  'invalid_payload',
  'unknown_message_type',
  'rate_limited',
  'game_over',
  'replaced_by_new_connection',
  'not_your_turn',
  'wrong_phase',
  'illegal_move',
  'piece_frozen',
  'unknown_spell',
  'card_not_in_hand',
  'insufficient_mana',
  'invalid_target_count',
  'invalid_target',
  'illegal_position',
  'draw_offer_pending',
  'no_draw_offer',
  'own_draw_offer',
  'internal_error',
] as const;
export type GameErrorCode = (typeof GAME_ERROR_CODES)[number];

/** `gameerr.Error`: il payload di `error` è `{message, code, details?}` (`game/client.go:126-137`). */
export interface GameError {
  readonly code: GameErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number>>;
}

const e = (code: GameErrorCode, message: string, details?: Record<string, string | number>): GameError =>
  details === undefined ? { code, message } : { code, message, details };

/** `%q` di Go su una stringa semplice. */
const quoted = (value: string) => JSON.stringify(value);

/** Errori WebSocket. */
export const WS = {
  // game/client.go
  rateLimited: e('rate_limited', 'Stai inviando messaggi troppo velocemente'), // :107
  malformedEnvelope: e('invalid_payload', 'Formato messaggio non valido'), // :113
  // game/manager.go, game/room.go: connessione sostituita
  replacedInQueue: e('replaced_by_new_connection', "Sei entrato in coda da un'altra connessione"), // manager.go:56
  replacedInGame: e('replaced_by_new_connection', "La partita è stata ripresa da un'altra connessione"), // room.go:1117
  // game/room.go
  gameOver: e('game_over', 'La partita è terminata'), // :361
  malformedMove: e('invalid_payload', 'Formato mossa non valido'), // :373
  malformedCast: e('invalid_payload', 'Formato cast_spell non valido'), // :387
  unknownType: (type: string) => e('unknown_message_type', `Tipo messaggio sconosciuto: ${type}`, { type }), // :405
  notYourTurn: e('not_your_turn', 'Non è il tuo turno'), // :435,585
  cannotMoveInPhase: (phase: string) => e('wrong_phase', `Non puoi muovere nella fase ${phase}`, { phase }), // :441
  illegalMove: (move: string) => e('illegal_move', `Mossa illegale: ${move}`, { move }), // :448
  frozen: (square: string) => e('piece_frozen', `Il pezzo in ${square} è congelato`, { square }), // :457
  cannotPassInPhase: (phase: string) => e('wrong_phase', `Non puoi passare nella fase ${phase}`, { phase }), // :591
  illegalPosition: (king: string) =>
    e('illegal_position', `posizione illegale: il re ${king} resterebbe sotto scacco senza avere il tratto`, { king }), // :728
  needsTargets: (name: string, expected: number, received: number) =>
    e('invalid_target_count', `la magia ${name} richiede ${expected} bersagli`, { expected, received }), // :749
  exposesOwnKing: (king: string) => e('illegal_position', 'mossa illegale: lascerebbe il re sotto scacco', { king }), // :829
  unsupportedEffect: (kind: string) => e('internal_error', `effetto non supportato: ${kind}`), // :844
  drawOfferPending: e('draw_offer_pending', "C'è già un'offerta di patta in corso"), // :1424
  noDrawOffer: e('no_draw_offer', 'Nessuna offerta di patta in corso'), // :1463
  ownDrawOffer: e('own_draw_offer', 'Non puoi rispondere alla tua stessa offerta'), // :1470
  // match/match.go
  castNotYourTurn: e('not_your_turn', 'non è il tuo turno'), // :302
  castWrongPhase: (phase: string) => e('wrong_phase', `non puoi castare magie nella fase ${phase}`, { phase }), // :305
  unknownSpell: (id: string) => e('unknown_spell', `magia sconosciuta: ${id}`, { spell_id: id }), // :311
  spellWrongPhase: (name: string, phase: string) => e('wrong_phase', `${name} non è giocabile nella fase ${phase}`, { phase }), // :314
  cardNotInHand: (id: string) => e('card_not_in_hand', 'carta non in mano', { spell_id: id }), // :321
  insufficientMana: (needed: number, available: number) =>
    e('insufficient_mana', `mana insufficiente: servono ${needed}, hai ${available}`, { needed, available }), // :324
  wrongTargetCount: (name: string, expected: number, received: number) =>
    e('invalid_target_count', `la magia ${name} richiede ${expected} bersagli, ricevuti ${received}`, { expected, received }), // :328
  // effects/effects.go
  invalidSquare: (square: string) => e('invalid_target', `casella non valida: ${quoted(square)}`), // :27
  offBoardSquare: (square: string) => e('invalid_target', `casella fuori scacchiera: ${quoted(square)}`), // :31
  nothingToDestroy: (square: string) => e('invalid_target', `nessun pezzo da distruggere in ${square}`), // :193
  cannotDestroyOwn: (square: string) => e('invalid_target', `non puoi distruggere un tuo pezzo (${square})`), // :196
  kingIndestructible: e('invalid_target', 'il re non può essere distrutto'), // :199
  nothingToMove: (square: string) => e('invalid_target', `nessun pezzo da spostare in ${square}`), // :231
  moveOnlyOwn: (square: string) => e('invalid_target', `puoi spostare solo i tuoi pezzi (${square})`), // :234
  destinationOccupied: (square: string) => e('invalid_target', `la casella ${square} non è vuota`), // :237
  // effects/tracker.go
  nothingAt: (square: string) => e('invalid_target', `nessun pezzo in ${square}`), // :159
  nothingToFreeze: (square: string) => e('invalid_target', `nessun pezzo da congelare in ${square}`), // :177
  cannotFreezeOwn: (square: string) => e('invalid_target', `non puoi congelare un tuo pezzo (${square})`), // :180
  nothingToShield: (square: string) => e('invalid_target', `nessun pezzo da proteggere in ${square}`), // :189
  shieldOnlyOwn: (square: string) => e('invalid_target', `puoi proteggere solo i tuoi pezzi (${square})`), // :192
} as const;

/** Messaggi informativi (mai mostrati dal client). */
export const INFO = {
  opponentDisconnected: "L'avversario si è disconnesso, aspettando riconnessione...", // game/room.go:1054
  opponentReconnected: (username: string) => `${username} si è riconnesso!`, // game/room.go:1146
  drawOfferSent: 'Offerta di patta inviata', // game/room.go:1446
  drawDeclined: (username: string) => `${username} ha rifiutato la patta`, // game/room.go:1497
  drawLapsed: (username: string) => `${username} ha giocato una mossa: offerta di patta decaduta`, // game/room.go:558
} as const;

/** Errore REST (`{success:false, error}`) con il codice che l'adapter deve ricavarne dal testo (ASSUMPTIONS C4). */
export interface ServerText {
  readonly message: string;
  readonly code: string;
}

const t = (message: string, code: string): ServerText => ({ message, code });

/** Errori REST. */
export const HTTP = {
  invalidBody: t('Dati non validi', 'invalid_request'), // handlers/auth.go:27,98,197
  missingFields: t('Username, email e password sono obbligatori', 'missing_fields'), // handlers/auth.go:37
  usernameTooShort: t('username deve avere almeno 3 caratteri', 'username_too_short'), // validation/validation.go:64
  usernameTooLong: t('username non può superare 20 caratteri', 'username_too_long'), // :67
  usernameChars: t('username può contenere solo lettere, numeri e underscore', 'username_invalid_chars'), // :70
  emailInvalid: t('email non valida', 'email_invalid'), // :75
  passwordTooShort: t('password deve avere almeno 8 caratteri', 'password_too_short'), // :88
  passwordTooLong: t('password non può superare 72 caratteri', 'password_too_long'), // :92
  passwordUpper: t('password deve contenere almeno una lettera maiuscola', 'password_needs_uppercase'), // :108
  passwordLower: t('password deve contenere almeno una lettera minuscola', 'password_needs_lowercase'), // :111
  passwordDigit: t('password deve contenere almeno un numero', 'password_needs_digit'), // :114
  internal: t('Errore interno', 'internal_error'), // handlers/auth.go:59
  taken: t('Username o email già in uso', 'username_or_email_taken'), // handlers/auth.go:78
  badCredentials: t('Credenziali non valide', 'invalid_credentials'), // handlers/auth.go:116,126
  tokenGeneration: t('Errore generazione token', 'internal_error'), // handlers/auth.go:137,145,247,257
  refreshInvalid: t('Refresh token non valido o scaduto', 'refresh_token_invalid'), // handlers/auth.go:210
  notRefreshToken: t('Token non valido', 'token_invalid'), // handlers/auth.go:222
  userNotFound: t('Utente non trovato', 'user_not_found'), // handlers/auth.go:236; handlers/stats.go:134
  profileError: t('Errore recupero profilo', 'internal_error'), // handlers/auth.go:288
  tokenMissing: t('Token mancante', 'token_missing'), // middleware/auth.go:36
  tokenInvalid: t('Token non valido o scaduto', 'token_invalid_or_expired'), // middleware/auth.go:42
  ticketInvalid: t('Ticket non valido o scaduto', 'ticket_invalid'), // middleware/wsticket.go:88
  ticketGeneration: t('Errore generazione ticket', 'internal_error'), // handlers/ws.go:30
  tooManyRequests: t('Troppe richieste, rallenta!', 'rate_limited'), // middleware/ratelimit.go:87
  invalidId: t('ID non valido', 'invalid_id'), // handlers/stats.go:60,119
  dbError: t('Errore DB', 'internal_error'), // handlers/stats.go:25,82
  notFound: t('Risorsa non trovata', 'not_found'), // api/router.go:33
  methodNotAllowed: t('Metodo non consentito', 'method_not_allowed'), // api/router.go:34
} as const;

/** Ogni errore WebSocket, con parametri realistici: usato dal controllo incrociato con l'adapter. */
export function wsErrorSamples(): GameError[] {
  return [
    WS.rateLimited,
    WS.malformedEnvelope,
    WS.replacedInQueue,
    WS.replacedInGame,
    WS.gameOver,
    WS.malformedMove,
    WS.malformedCast,
    WS.unknownType('chat'),
    WS.notYourTurn,
    WS.cannotMoveInPhase('main1'),
    WS.illegalMove('e2e5'),
    WS.frozen('e7'),
    WS.cannotPassInPhase('move'),
    WS.illegalPosition('black'),
    WS.needsTargets('Teleport', 2, 1),
    WS.exposesOwnKing('white'),
    WS.unsupportedEffect('summon'),
    WS.drawOfferPending,
    WS.noDrawOffer,
    WS.ownDrawOffer,
    WS.castNotYourTurn,
    WS.castWrongPhase('move'),
    WS.unknownSpell('fireball'),
    WS.spellWrongPhase('Frost Bolt', 'move'),
    WS.cardNotInHand('aegis'),
    WS.insufficientMana(4, 1),
    WS.wrongTargetCount('Teleport', 2, 1),
    WS.invalidSquare('e'),
    WS.offBoardSquare('z9'),
    WS.nothingToDestroy('e5'),
    WS.cannotDestroyOwn('e2'),
    WS.kingIndestructible,
    WS.nothingToMove('e5'),
    WS.moveOnlyOwn('e7'),
    WS.destinationOccupied('e4'),
    WS.nothingAt('e5'),
    WS.nothingToFreeze('e5'),
    WS.cannotFreezeOwn('e2'),
    WS.nothingToShield('e5'),
    WS.shieldOnlyOwn('e7'),
  ];
}

/** Ogni testo d'errore REST. */
export function httpErrorSamples(): ServerText[] {
  return Object.values(HTTP);
}
