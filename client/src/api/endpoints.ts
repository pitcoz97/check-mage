import {
  encodeAccountDeletion,
  encodeBlock,
  encodeChallenge,
  encodeDeck,
  encodeLogin,
  encodeRefresh,
  encodePrivacy,
  encodeRegister,
  encodeTermsAcceptance,
  normalizeAccount,
  normalizeBlocks,
  normalizeChallenge,
  normalizeCollection,
  normalizeDeck,
  normalizeDeckList,
  normalizeExport,
  normalizeFriendList,
  normalizeGameHistory,
  normalizeLeaderboard,
  normalizeLogin,
  normalizePasswordPolicy,
  normalizePresence,
  normalizePublicProfile,
  normalizeRegistration,
  normalizeSpellCatalog,
  normalizeTokenPair,
  normalizeUserSearch,
  normalizeWsTicket,
  type HttpOutcome,
  type Normalized,
} from './adapter';
import type { HttpClient } from './http';
import type { Spell } from '../spells/schema';
import type {
  AuthSession,
  BlockedUser,
  CardCollection,
  Challenge,
  Deck,
  DeckList,
  CredentialPolicy,
  FriendList,
  GameHistoryEntry,
  HttpErrorInfo,
  LeaderboardEntry,
  PresenceUpdate,
  PublicProfile,
  Registration,
  TokenPair,
  UserAccount,
  UserSearchResult,
  WsTicket,
} from './types';

/** Esito di una chiamata: dato già normalizzato dall'adapter, oppure errore con codice. */
export type ApiResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: HttpErrorInfo };

function toResult<T>(outcome: HttpOutcome, normalize: (data: unknown) => Normalized<T>): ApiResult<T> {
  if (!outcome.ok) return { ok: false, error: outcome.error };
  const normalized = normalize(outcome.data);
  return normalized.ok
    ? { ok: true, value: normalized.value }
    : { ok: false, error: { status: 200, code: 'invalid_response' } };
}

/** Il catalogo non fallisce mai: le voci invalide vengono scartate dall'adapter (G10). */
function normalizeCatalogList(data: unknown): Normalized<readonly Spell[]> {
  const catalog = normalizeSpellCatalog(data);
  return { ok: true, value: catalog.spells, warnings: catalog.warnings };
}

/** Endpoint REST usati dal client (chess-server `api/router.go`). */
export function createApi(http: HttpClient) {
  return {
    /** `consented`: termini, informativa ed età minima accettati (P1); il server rifiuta senza. */
    async register(username: string, email: string, password: string, consented: boolean): Promise<ApiResult<Registration>> {
      return toResult(await http.request('POST', '/auth/register', { body: encodeRegister(username, email, password, consented) }), normalizeRegistration);
    },

    async login(email: string, password: string): Promise<ApiResult<AuthSession>> {
      return toResult(await http.request('POST', '/auth/login', { body: encodeLogin(email, password) }), normalizeLogin);
    },

    /** Mai con `auth: true`: il refresh non deve innescare a sua volta la gestione del 401. */
    async refreshTokens(refreshToken: string): Promise<ApiResult<TokenPair>> {
      return toResult(await http.request('POST', '/auth/refresh', { body: encodeRefresh(refreshToken) }), normalizeTokenPair);
    },

    async fetchAccount(): Promise<ApiResult<UserAccount>> {
      return toResult(await http.request('GET', '/me', { auth: true }), normalizeAccount);
    },

    /** Accetta la versione corrente di Informativa e Termini (P2). Risponde con l'account aggiornato. */
    async acceptTerms(version: number): Promise<ApiResult<UserAccount>> {
      return toResult(await http.request('POST', '/me/terms', { auth: true, body: encodeTermsAcceptance(version) }), normalizeAccount);
    },

    /** Stato online nascosto agli altri (P6). Risponde con l'account aggiornato. */
    async updatePrivacy(hidePresence: boolean): Promise<ApiResult<UserAccount>> {
      return toResult(await http.request('PUT', '/me/privacy', { auth: true, body: encodePrivacy(hidePresence) }), normalizeAccount);
    },

    /** Cancella l'account (P3), con la password per conferma. */
    async deleteAccount(password: string): Promise<ApiResult<null>> {
      return toResult(await http.request('DELETE', '/me', { auth: true, body: encodeAccountDeletion(password) }), () => ({ ok: true, value: null, warnings: [] }));
    },

    /** Tutti i dati dell'utente, già come testo JSON da salvare (P5). */
    async exportData(): Promise<ApiResult<string>> {
      return toResult(await http.request('GET', '/me/export', { auth: true }), normalizeExport);
    },

    async fetchPublicProfile(userId: string): Promise<ApiResult<PublicProfile>> {
      return toResult(await http.request('GET', `/users/${encodeURIComponent(userId)}`), normalizePublicProfile);
    },

    /** Copie possedute di ogni magia (`handlers/collection.go`). Autenticato: il set iniziale arriva alla prima lettura. */
    async fetchCollection(): Promise<ApiResult<CardCollection>> {
      return toResult(await http.request('GET', '/me/collection', { auth: true }), normalizeCollection);
    },

    /** Mazzi personali (`handlers/decks.go`): alla prima lettura il server crea il mazzo iniziale (D4). */
    async fetchDecks(): Promise<ApiResult<DeckList>> {
      return toResult(await http.request('GET', '/me/decks', { auth: true }), normalizeDeckList);
    },

    async createDeck(name: string, cards: ReadonlyMap<string, number>): Promise<ApiResult<Deck>> {
      return toResult(await http.request('POST', '/me/decks', { auth: true, body: encodeDeck(name, cards) }), normalizeDeck);
    },

    async updateDeck(id: string, name: string, cards: ReadonlyMap<string, number>): Promise<ApiResult<Deck>> {
      return toResult(await http.request('PUT', `/me/decks/${encodeURIComponent(id)}`, { auth: true, body: encodeDeck(name, cards) }), normalizeDeck);
    },

    /** Risponde con la lista aggiornata (il mazzo attivo può essere cambiato, D5). */
    async deleteDeck(id: string): Promise<ApiResult<DeckList>> {
      return toResult(await http.request('DELETE', `/me/decks/${encodeURIComponent(id)}`, { auth: true }), normalizeDeckList);
    },

    async activateDeck(id: string): Promise<ApiResult<DeckList>> {
      return toResult(await http.request('POST', `/me/decks/${encodeURIComponent(id)}/activate`, { auth: true }), normalizeDeckList);
    },

    /** Amici con lo stato (`handlers/friends.go`); per ora tutti gli utenti (F1). */
    async fetchFriends(): Promise<ApiResult<FriendList>> {
      return toResult(await http.request('GET', '/me/friends', { auth: true }), normalizeFriendList);
    },

    /** Segnale «sono online» (F2): risponde con le sfide ricevute ancora aperte. */
    async sendPresence(): Promise<ApiResult<PresenceUpdate>> {
      return toResult(await http.request('POST', '/me/presence', { auth: true }), normalizePresence);
    },

    /** Sfida un amico online (`handlers/challenges.go`); poi si apre `/ws?challenge=<id>`. */
    async createChallenge(userId: string): Promise<ApiResult<Challenge>> {
      return toResult(await http.request('POST', '/me/challenges', { auth: true, body: encodeChallenge(userId) }), normalizeChallenge);
    },

    /** Chi sfida annulla, lo sfidato rifiuta (F6). */
    async deleteChallenge(id: string): Promise<ApiResult<null>> {
      return toResult(await http.request('DELETE', `/me/challenges/${encodeURIComponent(id)}`, { auth: true }), () => ({
        ok: true,
        value: null,
        warnings: [],
      }));
    },

    /** Richiesta d'amicizia (A2); se l'altro aveva già chiesto diventate subito amici (A3). Risponde con la lista. */
    async requestFriend(userId: string): Promise<ApiResult<FriendList>> {
      return toResult(await http.request('POST', '/me/friends/requests', { auth: true, body: encodeChallenge(userId) }), normalizeFriendList);
    },

    async acceptFriend(userId: string): Promise<ApiResult<FriendList>> {
      return toResult(await http.request('POST', `/me/friends/requests/${encodeURIComponent(userId)}/accept`, { auth: true }), normalizeFriendList);
    },

    /** Rifiuta la richiesta ricevuta da `userId`, o annulla quella inviata (A4). */
    async deleteFriendRequest(userId: string): Promise<ApiResult<FriendList>> {
      return toResult(await http.request('DELETE', `/me/friends/requests/${encodeURIComponent(userId)}`, { auth: true }), normalizeFriendList);
    },

    async removeFriend(userId: string): Promise<ApiResult<FriendList>> {
      return toResult(await http.request('DELETE', `/me/friends/${encodeURIComponent(userId)}`, { auth: true }), normalizeFriendList);
    },

    /** Ricerca per nome (A5), almeno 2 caratteri. */
    async searchUsers(query: string): Promise<ApiResult<readonly UserSearchResult[]>> {
      return toResult(await http.request('GET', `/users/search?q=${encodeURIComponent(query)}`, { auth: true }), normalizeUserSearch);
    },

    async fetchBlocks(): Promise<ApiResult<readonly BlockedUser[]>> {
      return toResult(await http.request('GET', '/me/blocks', { auth: true }), normalizeBlocks);
    },

    /** Blocca (A8): toglie amicizia e richieste. Risponde coi bloccati. */
    async blockUser(userId: string): Promise<ApiResult<readonly BlockedUser[]>> {
      return toResult(await http.request('POST', '/me/blocks', { auth: true, body: encodeBlock(userId) }), normalizeBlocks);
    },

    async unblockUser(userId: string): Promise<ApiResult<readonly BlockedUser[]>> {
      return toResult(await http.request('DELETE', `/me/blocks/${encodeURIComponent(userId)}`, { auth: true }), normalizeBlocks);
    },

    /** Ultime partite di un giocatore (`handlers/stats.go:54-108`), più recenti prima. */
    async fetchGameHistory(userId: string): Promise<ApiResult<readonly GameHistoryEntry[]>> {
      return toResult(await http.request('GET', `/users/${encodeURIComponent(userId)}/games`, { auth: true }), normalizeGameHistory);
    },

    /** Primi dieci per ELO (`handlers/stats.go:14-51`). Pubblico: niente posizione propria né stagione (P2-20). */
    async fetchLeaderboard(): Promise<ApiResult<readonly LeaderboardEntry[]>> {
      return toResult(await http.request('GET', '/leaderboard'), normalizeLeaderboard);
    },

    /** Requisiti di registrazione (`handlers/catalog.go:24-30`). Pubblico. */
    async fetchPasswordPolicy(): Promise<ApiResult<CredentialPolicy>> {
      return toResult(await http.request('GET', '/auth/password-policy'), normalizePasswordPolicy);
    },

    /** Catalogo delle magie (`handlers/catalog.go:13-20`). Pubblico. */
    async fetchSpellCatalog(): Promise<ApiResult<readonly Spell[]>> {
      return toResult(await http.request('GET', '/spells'), normalizeCatalogList);
    },

    /**
     * Ticket monouso per aprire il WebSocket (`handlers/ws.go:23-42`). Autenticato: un 401 passa dal refresh
     * condiviso di `http.ts`. Va chiesto a ogni apertura, anche nelle riconnessioni.
     */
    async fetchWsTicket(): Promise<ApiResult<WsTicket>> {
      return toResult(await http.request('GET', '/ws/ticket', { auth: true }), normalizeWsTicket);
    },
  };
}

export type Api = ReturnType<typeof createApi>;
