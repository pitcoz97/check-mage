/**
 * Amicizie e blocchi (`db/friends.go`, A1–A10): una riga per coppia nella direzione della richiesta, accettata =
 * amicizia; i blocchi a parte. Le regole stanno nelle rotte (`rest/app.ts`, come `handlers/friendships.go`).
 */

export interface FriendLink {
  readonly requester: number;
  readonly addressee: number;
  status: 'pending' | 'accepted';
}

export function createFriendStore() {
  const links: FriendLink[] = [];
  /** In ordine d'inserimento: il più recente in fondo. */
  const blocks: { readonly blocker: number; readonly blocked: number }[] = [];

  const index = (a: number, b: number) => links.findIndex((l) => (l.requester === a && l.addressee === b) || (l.requester === b && l.addressee === a));

  return {
    links(userId: number): FriendLink[] {
      return links.filter((l) => l.requester === userId || l.addressee === userId);
    },
    link(a: number, b: number): FriendLink | undefined {
      const i = index(a, b);
      return i < 0 ? undefined : links[i];
    },
    request(from: number, to: number): void {
      if (index(from, to) < 0) links.push({ requester: from, addressee: to, status: 'pending' });
    },
    accept(requester: number, addressee: number): boolean {
      const link = links.find((l) => l.requester === requester && l.addressee === addressee && l.status === 'pending');
      if (link === undefined) return false;
      link.status = 'accepted';
      return true;
    },
    deleteLink(a: number, b: number): boolean {
      const i = index(a, b);
      if (i < 0) return false;
      links.splice(i, 1);
      return true;
    },
    /** Bloccati da `userId`, dal più recente. */
    blocks(userId: number): number[] {
      return blocks
        .filter((b) => b.blocker === userId)
        .map((b) => b.blocked)
        .reverse();
    },
    blockedBy(userId: number): number[] {
      return blocks.filter((b) => b.blocked === userId).map((b) => b.blocker);
    },
    block(blocker: number, blocked: number): void {
      const i = index(blocker, blocked);
      if (i >= 0) links.splice(i, 1);
      if (!blocks.some((b) => b.blocker === blocker && b.blocked === blocked)) blocks.push({ blocker, blocked });
    },
    /** Legami e blocchi dell'utente cancellato (P3). */
    removeUser(userId: number): void {
      for (let i = links.length - 1; i >= 0; i--) if (links[i]?.requester === userId || links[i]?.addressee === userId) links.splice(i, 1);
      for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i]?.blocker === userId || blocks[i]?.blocked === userId) blocks.splice(i, 1);
    },
    unblock(blocker: number, blocked: number): boolean {
      const i = blocks.findIndex((b) => b.blocker === blocker && b.blocked === blocked);
      if (i < 0) return false;
      blocks.splice(i, 1);
      return true;
    },
  };
}

export type FriendStore = ReturnType<typeof createFriendStore>;
