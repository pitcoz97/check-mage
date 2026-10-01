import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { AppIcon, type AppIconName } from '../../design/components/AppIcon';
import { Spinner } from '../../design/components/Spinner';
import { useCatalog } from '../../spells/CatalogProvider';
import { RARITIES } from '../../spells/schema';
import { RARITY_FRAME } from '../../spells/texts';
import { useAuth } from '../../store/AuthProvider';
import { ownedByRarity } from '../Collection/collectionView';
import { useCollection } from '../Collection/useCollection';
import { byRecency, deckSigil } from '../Decks/deckEditor';
import { DeckSigil } from '../Decks/DeckSigil';
import { useDecks } from '../Decks/useDecks';
import { FriendAvatar } from '../Friends/FriendAvatar';
import { FriendRow } from '../Friends/FriendRow';
import { useChallenge } from '../Friends/useChallenge';
import { challengeable, useFriends } from '../Friends/useFriends';
import { RankingRows } from '../Leaderboard/RankingRows';
import { useLeaderboard } from '../Leaderboard/useLeaderboard';

/**
 * La riga di card in fondo alla home desktop (tavola "Home · desktop"): Mazzi (D12), Collezione (C9–C11), Classifica
 * (D11) e Amici (F1–F7).
 */

export function CardTitle({ icon, title, trailing, to }: { icon: AppIconName; title: string; trailing?: ReactNode; to?: string }) {
  const content = (
    <>
      <span className="flex size-8 items-center justify-center rounded-8 bg-elevated text-gold">
        <AppIcon name={icon} className="size-[18px]" />
      </span>
      <h3 className="grow font-display text-18 font-bold">{title}</h3>
      {trailing}
    </>
  );
  // Con `to` la riga del titolo è un link, col chevron della tavola.
  if (to === undefined) return <div className="flex items-center gap-2.5">{content}</div>;
  return (
    <Link to={to} className="flex items-center gap-2.5 text-primary">
      {content}
      <AppIcon name="chevron" strokeWidth={2.2} className="size-4 text-muted" />
    </Link>
  );
}

/** Quanti amici mostra la card: online e in partita prima, come li ordina il server. */
const FRIENDS_IN_CARD = 4;

/**
 * Amici in breve: quanti sono online, le richieste ricevute e i primi quattro (amici veri, poi gli altri giocatori),
 * con «Sfida» per chi è online.
 */
export function FriendsCard() {
  const { t } = useTranslation();
  const { state } = useFriends();
  const challenges = useChallenge();
  const list = state.kind === 'ready' ? state.list : null;
  const shown = list === null ? [] : challengeable(list).slice(0, FRIENDS_IN_CARD);

  return (
    <section data-friends-card className="flex flex-col gap-2 rounded-16 bg-panel p-[18px]">
      <CardTitle
        icon="friends"
        title={t('nav.friends')}
        to="/friends"
        trailing={list === null ? undefined : <span className="text-13 font-bold text-play-bright">{t('friends.onlineCount', { count: list.online })}</span>}
      />
      {state.kind === 'loading' && <Spinner label={t('friends.loading')} />}
      {state.kind === 'error' && <p className="text-14 text-muted">{t('friends.error')}</p>}
      {list !== null && list.incoming.length > 0 && (
        <Link to="/friends" data-friend-requests className="self-start rounded-pill bg-arcane-deep px-2.5 py-1 text-12 font-bold text-arcane-pale">
          {t('friends.requests.count', { count: list.incoming.length })}
        </Link>
      )}
      {list !== null && shown.length === 0 && <p className="text-14 text-muted">{t('friends.empty')}</p>}
      {shown.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {shown.map((friend) => (
            <FriendRow
              key={friend.id}
              friend={friend}
              compact
              canChallenge={challenges.canChallenge}
              sending={challenges.sending === friend.id}
              onChallenge={() => void challenges.challenge(friend)}
            />
          ))}
        </ul>
      )}
      <span className="grow" />
      <Link
        to="/friends"
        className="flex h-10 items-center justify-center rounded-10 bg-elevated text-14 font-bold text-primary shadow-edge-elevated hover:brightness-110"
      >
        {t('friends.all')}
      </Link>
    </section>
  );
}

/** Quanti avatar ci stanno nella riga Android. */
const FRIENDS_IN_ROW = 6;

/** Android: «Amici online» con gli avatar di chi è online (tavola "Home · Android"); tutta la riga porta agli Amici. */
export function FriendsOnlineRow() {
  const { t } = useTranslation();
  const { state } = useFriends();
  const online = state.kind === 'ready' ? challengeable(state.list).filter((f) => f.status === 'online') : [];

  return (
    <Link to="/friends" data-friends-online className="flex flex-col gap-2.5 rounded-16 bg-panel p-4 text-primary">
      <span className="flex items-center gap-2">
        <span className="grow text-12 font-extrabold tracking-[0.1em] text-muted uppercase">{t('home.friendsOnline')}</span>
        {state.kind === 'ready' && <span className="text-13 font-bold text-play-bright">{t('friends.onlineCount', { count: state.list.online })}</span>}
        <AppIcon name="chevron" strokeWidth={2.2} className="size-4 text-muted" />
      </span>
      {state.kind === 'ready' &&
        (online.length === 0 ? (
          <span className="text-14 text-muted">{t('friends.noneOnline')}</span>
        ) : (
          <span className="flex items-center gap-3">
            {online.slice(0, FRIENDS_IN_ROW).map((friend) => (
              <span key={friend.id} className="flex w-11 flex-col items-center gap-1">
                <FriendAvatar name={friend.username} status="online" />
                <span className="w-full truncate text-center text-11 text-muted">{friend.username}</span>
              </span>
            ))}
          </span>
        ))}
    </Link>
  );
}

/** Mazzi in breve (D12): quanti sono, i primi tre (l'attivo, poi i più recenti) e «+ Nuovo mazzo». */
export function DecksCard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const decks = useDecks();
  const byId = useCatalog((s) => s.byId);
  const { state } = decks;
  const list = state.kind === 'ready' ? state.list : null;
  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });

  return (
    <section data-decks-card className="flex flex-col gap-2 rounded-16 bg-panel p-[18px]">
      <CardTitle
        icon="decks"
        title={t('nav.decks')}
        to="/decks"
        trailing={list === null ? undefined : <span className="text-13 font-bold text-muted">{list.decks.length}</span>}
      />
      {state.kind === 'loading' && <Spinner label={t('decks.loading')} />}
      {state.kind === 'error' && <p className="text-14 text-muted">{t('decks.error')}</p>}
      {list !== null && (
        <ul className="flex flex-col gap-1">
          {byRecency(list.decks)
            .slice(0, 3)
            .map((deck) => (
              <li key={deck.id}>
                <Link
                  to={`/decks/${deck.id}`}
                  data-deck={deck.id}
                  className={`flex items-center gap-2.5 rounded-10 px-2 py-1.5 text-primary ${deck.active ? 'bg-sunken' : ''}`}
                >
                  <DeckSigil sigil={deckSigil(deck.cards, byId)} size="sm" />
                  <span className="flex min-w-0 flex-col gap-px">
                    <span className="truncate text-14 font-bold">{deck.name}</span>
                    <span className="text-12 text-muted">
                      {deck.active
                        ? t('decks.active')
                        : deck.valid
                          ? t('decks.modified', { date: date(deck.updatedAt) })
                          : t('decks.draftCount', { count: deck.size, size: list.deckSize })}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
        </ul>
      )}
      <span className="grow" />
      <button
        type="button"
        disabled={list === null || list.decks.length >= list.maxDecks}
        onClick={() =>
          void decks.create(t('decks.newDeckName'), new Map()).then((result) => {
            if (result.ok) void navigate(`/decks/${result.value.id}`);
          })
        }
        className="flex h-10 items-center justify-center gap-1.5 rounded-10 bg-elevated text-14 font-bold text-primary shadow-edge-elevated hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <AppIcon name="plus" strokeWidth={2.4} className="size-4" />
        {t('decks.newDeck')}
      </button>
    </section>
  );
}

/** Collezione in breve: copie possedute su quelle possibili e per rarità (`GET /me/collection`). */
export function CollectionCard() {
  const { t } = useTranslation();
  const { state } = useCollection();
  const byRarity = state.kind === 'ready' ? ownedByRarity(state.items) : null;

  return (
    <section data-collection-card className="flex flex-col gap-2 rounded-16 bg-panel p-[18px]">
      <CardTitle icon="collection" title={t('nav.collection')} to="/collection" />
      {state.kind === 'loading' && <Spinner label={t('collection.loading')} />}
      {state.kind === 'error' && <p className="text-14 text-muted">{t('collection.error')}</p>}
      {state.kind === 'ready' && byRarity !== null && (
        <>
          <p className="flex items-baseline gap-1.5">
            <span className="font-display text-[34px] leading-[1.1] font-extrabold text-gold-bright">{state.owned}</span>
            <span className="text-15 font-semibold text-muted">{t('home.collectionOf', { total: state.total })}</span>
          </p>
          <div
            role="progressbar"
            aria-label={t('collection.progress', { owned: state.owned, total: state.total })}
            aria-valuemin={0}
            aria-valuemax={state.total}
            aria-valuenow={state.owned}
            className="h-2 overflow-hidden rounded-pill bg-sunken"
          >
            <div className="h-full rounded-pill bg-gold" style={{ width: `${state.total === 0 ? 0 : Math.round((state.owned / state.total) * 100)}%` }} />
          </div>
          <ul className="flex flex-col gap-2 text-14">
            {RARITIES.map((rarity) => (
              <li key={rarity} data-rarity={rarity} className="flex items-center gap-2.5">
                <span aria-hidden="true" className={`size-2.5 rotate-45 ${RARITY_FRAME[rarity].gem}`} />
                <span className="grow">{t(`collection.rarityFilter.${rarity}`)}</span>
                <span className="font-bold">{byRarity[rarity]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <span className="grow" />
      <Link
        to="/collection"
        className="flex h-10 items-center justify-center rounded-10 bg-elevated text-14 font-bold text-primary shadow-edge-elevated hover:brightness-110"
      >
        {t('home.browseCards')}
      </Link>
    </section>
  );
}

/** Classifica in breve: il podio e, se è fra i primi dieci, la propria riga (P2-20 per il resto). */
export function RankingCard() {
  const { t } = useTranslation();
  const selfId = useAuth((s) => s.account?.id ?? null);
  const { state } = useLeaderboard();
  const entries = state.kind === 'ready' ? state.entries : [];
  const own = entries.find((entry) => entry.id === selfId && entry.rank > 3);
  const shown = [...entries.slice(0, 3), ...(own === undefined ? [] : [own])];

  return (
    <section data-ranking-card className="flex flex-col gap-1.5 rounded-16 bg-panel p-[18px]">
      <CardTitle icon="ranking" title={t('nav.ranking')} />
      {state.kind === 'loading' && <Spinner label={t('leaderboard.loading')} />}
      {state.kind === 'error' && <p className="text-14 text-muted">{t('leaderboard.error')}</p>}
      {state.kind === 'ready' &&
        (shown.length === 0 ? <p className="text-14 text-muted">{t('leaderboard.empty')}</p> : <RankingRows entries={shown} selfId={selfId} compact />)}
      <span className="grow" />
      <Link
        to="/leaderboard"
        className="flex h-10 items-center justify-center rounded-10 bg-elevated text-14 font-bold text-primary shadow-edge-elevated hover:brightness-110"
      >
        {t('home.fullRanking')}
      </Link>
    </section>
  );
}
