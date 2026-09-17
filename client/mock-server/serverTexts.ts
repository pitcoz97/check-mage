/**
 * Testi esatti prodotti da chess-server (commit 7f817e5), copiati dal codice Go.
 *
 * Il mock NON importa nulla dall'adapter del client: se i due divergono, `tests/error-texts.test.ts`
 * se ne accorge. Ogni testo porta anche il codice che il server esporrebbe con P1-3 (contratto `proposed`).
 */

export interface ServerText {
  readonly message: string;
  /** Codice proposto in BACKEND-REQUESTS P1-3. Inviato solo nel contratto `proposed`. */
  readonly code: string;
}

const t = (message: string, code: string): ServerText => ({ message, code });

/** Errori WebSocket (`{type:"error", payload:{message}}`). */
export const WS = {
  malformedEnvelope: t('Formato messaggio non valido', 'malformed_message'), // game/client.go:70
  rateLimited: t('Stai inviando messaggi troppo velocemente', 'rate_limited'), // game/client.go:64
  alreadyQueued: t('Sei già in coda', 'already_queued'), // game/manager.go:60
  malformedMove: t('Formato mossa non valido', 'malformed_message'), // game/room.go:276
  malformedCast: t('Formato cast_spell non valido', 'malformed_message'), // game/room.go:290
  unknownType: (type: string) => t(`Tipo messaggio sconosciuto: ${type}`, 'unknown_message_type'), // game/room.go:308
  notYourTurn: t('Non è il tuo turno', 'not_your_turn'), // game/room.go:318,443
  cannotMoveInPhase: (phase: string) => t(`Non puoi muovere nella fase ${phase}`, 'wrong_phase'), // game/room.go:324
  illegalMove: (move: string) => t(`Mossa illegale: ${move}`, 'illegal_move'), // game/room.go:330
  frozen: (square: string) => t(`Il pezzo in ${square} è congelato`, 'piece_frozen'), // game/room.go:339
  cannotPassInPhase: (phase: string) => t(`Non puoi passare nella fase ${phase}`, 'wrong_phase'), // game/room.go:449
  drawOfferPending: t("C'è già un'offerta di patta in corso", 'draw_offer_pending'), // game/room.go:1149
  noDrawOffer: t('Nessuna offerta di patta in corso', 'no_draw_offer'), // game/room.go:1179
  ownDrawOffer: t('Non puoi rispondere alla tua stessa offerta', 'own_draw_offer'), // game/room.go:1186
  // match/match.go
  castNotYourTurn: t('non è il tuo turno', 'not_your_turn'), // :303
  castWrongPhase: (phase: string) => t(`non puoi castare magie nella fase ${phase}`, 'wrong_phase'), // :306
  unknownSpell: (id: string) => t(`magia sconosciuta: ${id}`, 'unknown_spell'), // :311
  spellWrongPhase: (name: string, phase: string) => t(`${name} non è giocabile nella fase ${phase}`, 'wrong_phase'), // :314
  cardNotInHand: t('carta non in mano', 'card_not_in_hand'), // :320
  insufficientMana: (needed: number, available: number) =>
    t(`mana insufficiente: servono ${needed}, hai ${available}`, 'insufficient_mana'), // :323
  wrongTargetCount: (name: string, expected: number, got: number) =>
    t(`la magia ${name} richiede ${expected} bersagli, ricevuti ${got}`, 'wrong_target_count'), // :326
  // game/room.go applySpellEffects
  needsTarget: (name: string) => t(`la magia ${name} richiede un bersaglio`, 'wrong_target_count'), // :588
  needsFromTo: (name: string) => t(`la magia ${name} richiede casella di partenza e arrivo`, 'wrong_target_count'), // :646
  exposesOwnKing: t('mossa illegale: lascerebbe il re sotto scacco', 'exposes_own_king'), // :654
  unsupportedEffect: (kind: string) => t(`effetto non supportato: ${kind}`, 'unsupported_effect'), // :664
  // effects/effects.go
  invalidSquare: (square: string) => t(`casella non valida: ${JSON.stringify(square)}`, 'invalid_square'), // :25
  offBoardSquare: (square: string) => t(`casella fuori scacchiera: ${JSON.stringify(square)}`, 'invalid_square'), // :29
  nothingToDestroy: (square: string) => t(`nessun pezzo da distruggere in ${square}`, 'no_piece_on_target'), // :191
  cannotDestroyOwn: (square: string) => t(`non puoi distruggere un tuo pezzo (${square})`, 'target_must_be_enemy'), // :194
  kingIndestructible: t('il re non può essere distrutto', 'king_not_targetable'), // :197
  nothingToMove: (square: string) => t(`nessun pezzo da spostare in ${square}`, 'no_piece_on_target'), // :229
  moveOnlyOwn: (square: string) => t(`puoi spostare solo i tuoi pezzi (${square})`, 'target_must_be_own'), // :232
  destinationOccupied: (square: string) => t(`la casella ${square} non è vuota`, 'destination_occupied'), // :235
  // effects/tracker.go
  nothingAt: (square: string) => t(`nessun pezzo in ${square}`, 'no_piece_on_target'), // :138
  nothingToFreeze: (square: string) => t(`nessun pezzo da congelare in ${square}`, 'no_piece_on_target'), // :157
  cannotFreezeOwn: (square: string) => t(`non puoi congelare un tuo pezzo (${square})`, 'target_must_be_enemy'), // :159
  nothingToShield: (square: string) => t(`nessun pezzo da proteggere in ${square}`, 'no_piece_on_target'), // :168
  shieldOnlyOwn: (square: string) => t(`puoi proteggere solo i tuoi pezzi (${square})`, 'target_must_be_own'), // :171
} as const;

/** Messaggi informativi (mai mostrati dal client). */
export const INFO = {
  opponentDisconnected: "L'avversario si è disconnesso, aspettando riconnessione...", // game/room.go:870
  opponentReconnected: (username: string) => `${username} si è riconnesso!`, // game/room.go:934
  drawOfferSent: 'Offerta di patta inviata', // game/room.go:1168
  drawDeclined: (username: string) => `${username} ha rifiutato la patta`, // game/room.go:1207
} as const;

/** Errori REST (`{success:false, error}`). */
export const HTTP = {
  invalidBody: t('Dati non validi', 'invalid_request'), // handlers/auth.go:27
  missingFields: t('Username, email e password sono obbligatori', 'missing_fields'), // handlers/auth.go:37
  usernameTooShort: t('username deve avere almeno 3 caratteri', 'username_too_short'), // validation/validation.go:15
  usernameTooLong: t('username non può superare 20 caratteri', 'username_too_long'), // :18
  usernameChars: t('username può contenere solo lettere, numeri e underscore', 'username_invalid_chars'), // :21
  emailInvalid: t('email non valida', 'email_invalid'), // :26
  passwordTooShort: t('password deve avere almeno 8 caratteri', 'password_too_short'), // :39
  passwordTooLong: t('password non può superare 72 caratteri', 'password_too_long'), // :43
  passwordUpper: t('password deve contenere almeno una lettera maiuscola', 'password_needs_uppercase'), // :59
  passwordLower: t('password deve contenere almeno una lettera minuscola', 'password_needs_lowercase'), // :62
  passwordDigit: t('password deve contenere almeno un numero', 'password_needs_digit'), // :65
  internal: t('Errore interno', 'internal_error'), // handlers/auth.go:59
  taken: t('Username o email già in uso', 'username_or_email_taken'), // handlers/auth.go:78
  badCredentials: t('Credenziali non valide', 'invalid_credentials'), // handlers/auth.go:116,126
  tokenGeneration: t('Errore generazione token', 'internal_error'), // handlers/auth.go:137
  refreshInvalid: t('Refresh token non valido o scaduto', 'refresh_token_invalid'), // handlers/auth.go:210
  notRefreshToken: t('Token non valido', 'token_invalid'), // handlers/auth.go:222
  userNotFound: t('Utente non trovato', 'user_not_found'), // handlers/auth.go:236; handlers/stats.go:134
  profileError: t('Errore recupero profilo', 'internal_error'), // handlers/auth.go:288
  tokenMissing: t('Token mancante', 'token_missing'), // middleware/auth.go:38
  tokenInvalid: t('Token non valido o scaduto', 'token_invalid_or_expired'), // middleware/auth.go:52
  tooManyRequests: t('Troppe richieste, rallenta!', 'rate_limited'), // middleware/ratelimit.go:85
  invalidId: t('ID non valido', 'invalid_id'), // handlers/stats.go:60,119
  dbError: t('Errore DB', 'internal_error'), // handlers/stats.go:25,82
} as const;

/** Ogni testo d'errore WebSocket, con parametri realistici: usato dal controllo incrociato con l'adapter. */
export function wsErrorSamples(): ServerText[] {
  return [
    WS.malformedEnvelope,
    WS.rateLimited,
    WS.alreadyQueued,
    WS.malformedMove,
    WS.malformedCast,
    WS.unknownType('chat'),
    WS.notYourTurn,
    WS.cannotMoveInPhase('main1'),
    WS.illegalMove('e2e5'),
    WS.frozen('e7'),
    WS.cannotPassInPhase('move'),
    WS.drawOfferPending,
    WS.noDrawOffer,
    WS.ownDrawOffer,
    WS.castNotYourTurn,
    WS.castWrongPhase('move'),
    WS.unknownSpell('fireball'),
    WS.spellWrongPhase('Frost Bolt', 'move'),
    WS.cardNotInHand,
    WS.insufficientMana(4, 1),
    WS.wrongTargetCount('Teleport', 2, 1),
    WS.needsTarget('Aegis'),
    WS.needsFromTo('Teleport'),
    WS.exposesOwnKing,
    WS.unsupportedEffect('summon'),
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
