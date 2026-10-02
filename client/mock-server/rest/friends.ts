import type { MockConfig } from '../config';
import { HTTP, type ServerText } from '../serverTexts';
import type { FriendStore } from '../store/friends';
import type { PresenceStore } from '../store/presence';
import type { User, UserStore } from '../store/users';

/**
 * Porting di `handlers/friends.go` e `handlers/friendships.go` (A1–A10): lista degli amici, richieste, ricerca e
 * blocchi. Ogni operazione restituisce lo status e il dato, oppure l'errore; le rotte sono in `app.ts`.
 */

/** `handlers.MaxListed`, `MaxFriendsPerUser`, `MaxPendingOut`, `MaxSearchResults`, `MinSearchLength`. */
export const MAX_LISTED = 100;
export const MAX_FRIENDS_PER_USER = 200;
export const MAX_PENDING_OUT = 50;
const MAX_SEARCH_RESULTS = 20;
const MIN_SEARCH_LENGTH = 2;

type FriendStatus = 'online' | 'playing' | 'offline';
const STATUS_RANK: Record<FriendStatus, number> = { online: 0, playing: 1, offline: 2 };
type Relation = 'friend' | 'incoming' | 'outgoing';

export type Outcome = { readonly ok: true; readonly status: number; readonly data: unknown } | { readonly ok: false; readonly status: number; readonly error: ServerText };

export interface FriendsDeps {
  readonly config: MockConfig;
  readonly users: UserStore;
  readonly friends: FriendStore;
  readonly presence: PresenceStore;
  readonly matches: { inMatch(userId: number): boolean; playingIds(): number[] };
  /** `GameManager.CloseChallengesBetween`. */
  readonly closeChallengesBetween: (a: number, b: number) => void;
}

const byName = (a: { username: string }, b: { username: string }) => a.username.toLowerCase().localeCompare(b.username.toLowerCase());

export function createFriendsApi({ config, users, friends, presence, matches, closeChallengesBetween }: FriendsDeps) {
  const fail = (status: number, error: ServerText): Outcome => ({ ok: false, status, error });

  function hiddenFor(userId: number): Set<number> {
    return new Set([...friends.blocks(userId), ...friends.blockedBy(userId)]);
  }

  function relations(userId: number): Map<number, Relation> {
    const out = new Map<number, Relation>();
    for (const l of friends.links(userId)) {
      const other = l.requester === userId ? l.addressee : l.requester;
      out.set(other, l.status === 'accepted' ? 'friend' : l.addressee === userId ? 'incoming' : 'outgoing');
    }
    return out;
  }

  function counts(userId: number): { friends: number; pendingOut: number } {
    let accepted = 0;
    let pendingOut = 0;
    for (const l of friends.links(userId)) {
      if (l.status === 'accepted') accepted++;
      else if (l.requester === userId) pendingOut++;
    }
    return { friends: accepted, pendingOut };
  }

  /** `buildFriendList`. */
  function list(userId: number) {
    // Chi ha nascosto il proprio stato appare sempre offline (P6).
    const hiddenPresence = new Set(users.all().filter((u) => u.hidePresence).map((u) => u.id));
    const statuses = new Map<number, FriendStatus>();
    for (const id of presence.onlineIds()) if (!hiddenPresence.has(id)) statuses.set(id, 'online');
    for (const id of matches.playingIds()) if (!hiddenPresence.has(id)) statuses.set(id, 'playing');
    const view = (u: User) => ({ id: u.id, username: u.username, elo: u.elo, status: statuses.get(u.id) ?? ('offline' as FriendStatus) });
    const sort = <T extends { username: string; status: FriendStatus }>(items: T[]) =>
      items.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || byName(a, b));

    const rel = relations(userId);
    const hidden = hiddenFor(userId);
    const linked = users.all().filter((u) => rel.has(u.id));
    const of = (kind: Relation) => sort(linked.filter((u) => rel.get(u.id) === kind).map(view));
    const others = config.allFriends
      ? sort(
          users
            .all()
            .filter((u) => u.id !== userId && !rel.has(u.id) && !hidden.has(u.id))
            .sort((a, b) => Number(statuses.has(b.id)) - Number(statuses.has(a.id)) || byName(a, b) || a.id - b.id)
            .slice(0, MAX_LISTED)
            .map(view),
        )
      : [];
    const mine = of('friend');
    return {
      friends: mine,
      others,
      incoming: of('incoming'),
      outgoing: of('outgoing'),
      online: [...mine, ...others].filter((f) => f.status === 'online').length,
      max_friends: MAX_FRIENDS_PER_USER,
    };
  }

  const listed = (userId: number, status = 200): Outcome => ({ ok: true, status, data: list(userId) });

  function blockList(userId: number) {
    return friends
      .blocks(userId)
      .map((id) => users.findById(id))
      .filter((u): u is User => u !== undefined)
      .map((u) => ({ id: u.id, username: u.username }));
  }

  return {
    list,
    listed,

    /** `isFriend`: amici veri o tutti con `allFriends`, mai con un blocco. */
    isFriend(a: number, b: number): boolean {
      if (a === b || hiddenFor(a).has(b)) return false;
      return config.allFriends || friends.link(a, b)?.status === 'accepted';
    },

    /** Legami e blocchi di un utente cancellato (P3). */
    forgetUser(userId: number): void {
      friends.removeUser(userId);
    },

    /** I bloccati, per l'esportazione dei dati (P5). */
    blockList,

    incomingCount(userId: number): number {
      return friends.links(userId).filter((l) => l.status === 'pending' && l.addressee === userId).length;
    },

    /** `RequestFriend` + `planFriendRequest`. */
    request(me: number, to: unknown): Outcome {
      if (typeof to !== 'number' || !Number.isInteger(to) || to <= 0) return fail(400, HTTP.invalidBody);
      if (to === me) return fail(400, HTTP.friendSelf);
      if (users.findById(to) === undefined || hiddenFor(me).has(to)) return fail(404, HTTP.challengeNoPlayer);
      const link = friends.link(me, to);
      if (link?.status === 'accepted') return fail(409, HTTP.friendAlready);
      if (link !== undefined && link.requester === me) return fail(409, HTTP.friendPending);
      const mine = counts(me);
      if (mine.friends >= MAX_FRIENDS_PER_USER) return fail(409, HTTP.friendLimit);
      if (counts(to).friends >= MAX_FRIENDS_PER_USER) return fail(409, HTTP.friendTheirLimit);
      if (link !== undefined) friends.accept(to, me);
      else if (mine.pendingOut >= MAX_PENDING_OUT) return fail(409, HTTP.friendPendingLimit);
      else friends.request(me, to);
      return listed(me, 201);
    },

    accept(me: number, other: number): Outcome {
      const link = friends.link(me, other);
      if (link === undefined || link.status !== 'pending' || link.addressee !== me) return fail(404, HTTP.friendRequestAbsent);
      if (counts(me).friends >= MAX_FRIENDS_PER_USER) return fail(409, HTTP.friendLimit);
      if (counts(other).friends >= MAX_FRIENDS_PER_USER) return fail(409, HTTP.friendTheirLimit);
      friends.accept(other, me);
      return listed(me);
    },

    /** Rifiuta o annulla (`status: 'pending'`) oppure rimuove l'amico (`'accepted'`). */
    deleteLink(me: number, other: number, status: 'pending' | 'accepted'): Outcome {
      if (friends.link(me, other)?.status !== status) return fail(404, status === 'pending' ? HTTP.friendRequestAbsent : HTTP.friendAbsent);
      friends.deleteLink(me, other);
      return listed(me);
    },

    /** `SearchUsers`. */
    search(me: number, raw: unknown): Outcome {
      const q = typeof raw === 'string' ? raw.trim() : '';
      if ([...q].length < MIN_SEARCH_LENGTH) return fail(400, HTTP.searchShort);
      const needle = q.toLowerCase();
      const rel = relations(me);
      const hidden = hiddenFor(me);
      const found = users
        .all()
        .filter((u) => u.id !== me && !hidden.has(u.id) && u.username.toLowerCase().includes(needle))
        .sort(
          (a, b) =>
            Number(b.username.toLowerCase().startsWith(needle)) - Number(a.username.toLowerCase().startsWith(needle)) || byName(a, b) || a.id - b.id,
        )
        .slice(0, MAX_SEARCH_RESULTS)
        .map((u) => ({ id: u.id, username: u.username, elo: u.elo, relation: rel.get(u.id) ?? 'none' }));
      return { ok: true, status: 200, data: found };
    },

    blocks(me: number): Outcome {
      return { ok: true, status: 200, data: blockList(me) };
    },

    block(me: number, target: unknown): Outcome {
      if (typeof target !== 'number' || !Number.isInteger(target) || target <= 0) return fail(400, HTTP.invalidBody);
      if (target === me) return fail(400, HTTP.blockSelf);
      if (users.findById(target) === undefined) return fail(404, HTTP.challengeNoPlayer);
      friends.block(me, target);
      closeChallengesBetween(me, target);
      return { ok: true, status: 200, data: blockList(me) };
    },

    unblock(me: number, target: number): Outcome {
      if (!friends.unblock(me, target)) return fail(404, HTTP.blockAbsent);
      return { ok: true, status: 200, data: blockList(me) };
    },
  };
}

export type FriendsApi = ReturnType<typeof createFriendsApi>;
