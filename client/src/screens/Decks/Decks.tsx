import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useBlocker, useLocation, useNavigate, useParams } from 'react-router';

import type { Deck, DeckList, HttpErrorCode } from '../../api/types';
import { AppIcon } from '../../design/components/AppIcon';
import { Button } from '../../design/components/Button';
import { InfoBox } from '../../design/components/InfoBox';
import { Spinner } from '../../design/components/Spinner';
import type { SpellId } from '../../game/model';
import { DESKTOP_QUERY, useMediaQuery } from '../../lib/useMediaQuery';
import { useCatalog } from '../../spells/CatalogProvider';
import type { Spell } from '../../spells/schema';
import { DEFAULT_FILTERS, visibleItems, type CollectionFilters, type CollectionItem } from '../Collection/collectionView';
import { useCollection } from '../Collection/useCollection';
import { ArchetypeChips, DeckProgress, DeckRows, DeckStatusPill, ManaCurve } from './DeckPanel';
import { PoolFilters, PoolGrid } from './DeckPool';
import { DeckSigil } from './DeckSigil';
import { addCard, autofill, byRecency, deckRows, deckSigil, deckTotal, isDirty, nameValid, removeCard, type DeckCards } from './deckEditor';
import { useDecks, type DecksApi } from './useDecks';

/**
 * Mazzi (tavole "Mazzi · desktop" e "Mazzi · Android"). Desktop: schede dei mazzi, «Le tue carte» e il pannello
 * del mazzo scelto (l'attivo, se l'URL non ne indica uno). Android: `/decks` è la lista dei mazzi, `/decks/:id`
 * l'editor della tavola (D11, lista non disegnata). Il mazzo attivo si sceglie con «Usa in partita» (D12).
 */
export function Decks() {
  const { t } = useTranslation();
  const decks = useDecks();
  const { state: collection, retry: retryCollection } = useCollection();
  const byId = useCatalog((s) => s.byId);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const { id } = useParams();
  const base = useDecksBase(id);

  if (decks.state.kind === 'loading' || collection.kind === 'loading') return <Spinner label={t('decks.loading')} />;
  if (decks.state.kind === 'error' || collection.kind === 'error') {
    return (
      <div className="flex flex-col items-start gap-3">
        <h1 className="font-display text-[26px] font-bold lg:text-32">{t('decks.title')}</h1>
        <p role="alert">{t('decks.error')}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            decks.retry();
            retryCollection();
          }}
        >
          {t('decks.retry')}
        </Button>
      </div>
    );
  }

  const list = decks.state.list;
  if (!desktop && id === undefined) return <DeckListPage list={list} byId={byId} base={base} decks={decks} />;
  const selected = list.decks.find((d) => d.id === id) ?? (id === undefined ? (list.decks.find((d) => d.active) ?? list.decks[0]) : undefined);
  if (selected === undefined) return <Navigate to={base} replace />;
  return (
    <DeckEditor
      key={`${selected.id}:${selected.updatedAt}`}
      deck={selected}
      list={list}
      items={collection.items}
      byId={byId}
      base={base}
      decks={decks}
      desktop={desktop}
    />
  );
}

/** La radice della pagina (`/decks`, o `/dev/home/decks` nelle anteprime): con `:id` nell'URL, il genitore. */
function useDecksBase(id: string | undefined): string {
  const { pathname } = useLocation();
  const trimmed = pathname.replace(/\/+$/, '');
  return id === undefined ? trimmed : trimmed.slice(0, trimmed.lastIndexOf('/'));
}

function errorText(t: ReturnType<typeof useTranslation>['t'], code: HttpErrorCode | null): string {
  return code === null ? t('decks.saveError') : t(`errors.http.${code}`);
}

/** «+ Nuovo mazzo»: crea una bozza vuota sul server e la apre. */
function useNewDeck(decks: DecksApi, base: string, onError: (code: HttpErrorCode | null) => void) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return async () => {
    const result = await decks.create(t('decks.newDeckName'), new Map());
    if (result.ok) void navigate(`${base}/${result.value.id}`);
    else onError(result.code);
  };
}

function NewDeckButton({ list, onClick, className = '' }: { list: DeckList; onClick(): void; className?: string }) {
  const { t } = useTranslation();
  const full = list.decks.length >= list.maxDecks;
  return (
    <button
      type="button"
      data-action="new-deck"
      disabled={full}
      title={full ? t('errors.http.deck_limit') : undefined}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-12 border-[1.5px] border-dashed border-control-off px-4 text-14 font-extrabold text-gold disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      <AppIcon name="plus" strokeWidth={2.4} className="size-4" />
      {t('decks.newDeck')}
    </button>
  );
}

function ActivePill() {
  const { t } = useTranslation();
  return <span className="rounded-pill bg-play/25 px-2 py-0.5 text-11 font-extrabold text-valid-ink">{t('decks.active')}</span>;
}

// --- Android: la lista dei mazzi -----------------------------------------------------------------

function DeckListPage({ list, byId, base, decks }: { list: DeckList; byId: ReadonlyMap<SpellId, Spell>; base: string; decks: DecksApi }) {
  const { t } = useTranslation();
  const [error, setError] = useState<HttpErrorCode | null | undefined>(undefined);
  const newDeck = useNewDeck(decks, base, setError);
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-baseline gap-2.5">
        <h1 className="font-display text-[26px] font-bold">{t('decks.title')}</h1>
        <span className="grow" />
        <span className="text-12 font-semibold text-muted">{t('decks.rules', { size: list.deckSize })}</span>
      </header>
      <ul className="flex flex-col gap-2">
        {byRecency(list.decks).map((deck) => (
          <li key={deck.id}>
            <Link to={`${base}/${deck.id}`} data-deck={deck.id} className="flex min-h-15 items-center gap-3 rounded-12 bg-panel px-3 py-2.5 text-primary">
              <DeckSigil sigil={deckSigil(deck.cards, byId)} size="lg" />
              <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="truncate font-display text-16 font-bold">{deck.name}</span>
                <span className="text-12 text-muted">
                  {deck.valid ? t('decks.count', { count: deck.size, size: list.deckSize }) : t('decks.draftCount', { count: deck.size, size: list.deckSize })}
                </span>
              </span>
              {deck.active && <ActivePill />}
              <AppIcon name="chevron" strokeWidth={2.2} className="size-4 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
      <NewDeckButton list={list} onClick={() => void newDeck()} className="h-[52px] justify-center" />
      {error !== undefined && (
        <InfoBox tone="danger" role="alert">
          {errorText(t, error)}
        </InfoBox>
      )}
    </div>
  );
}

// --- L'editor ------------------------------------------------------------------------------------

interface EditorProps {
  deck: Deck;
  list: DeckList;
  items: readonly CollectionItem[];
  byId: ReadonlyMap<SpellId, Spell>;
  base: string;
  decks: DecksApi;
  desktop: boolean;
}

function DeckEditor({ deck, list, items, byId, base, decks, desktop }: EditorProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState(deck.name);
  const [cards, setCards] = useState<DeckCards>(deck.cards);
  const [filters, setFilters] = useState<CollectionFilters>(DEFAULT_FILTERS);
  const [tab, setTab] = useState<'deck' | 'add'>('deck');
  const [error, setError] = useState<HttpErrorCode | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const leaving = useRef(false);

  const deckSize = list.deckSize;
  const total = deckTotal(cards);
  const dirty = isDirty({ name, cards }, deck);
  const locale = i18n.language;
  const pool = useMemo(() => visibleItems(items, filters, locale), [items, filters, locale]);
  const rows = useMemo(() => deckRows(cards, items, locale), [cards, items, locale]);
  const sigil = deckSigil(cards, byId);
  const activeNeedsValid = deck.active && total !== deckSize;
  const canSave = dirty && nameValid(name) && !activeNeedsValid && !busy;
  const canUse = !deck.active && deck.valid && !dirty && !busy;

  // Modifiche non salvate: conferma prima di cambiare pagina o mazzo, e alla chiusura della scheda (D10).
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const add = (item: CollectionItem) => setCards((current) => addCard(current, item, deckSize));
  const remove = (item: CollectionItem) => setCards((current) => removeCard(current, item.spell.id));
  const newDeck = useNewDeck(decks, base, setError);

  async function run<T>(action: () => Promise<{ ok: true; value: T } | { ok: false; code: HttpErrorCode | null }>): Promise<T | null> {
    setBusy(true);
    setError(undefined);
    const result = await action();
    setBusy(false);
    if (result.ok) return result.value;
    setError(result.code);
    return null;
  }

  const save = () => void run(() => decks.update(deck.id, name.trim(), cards));
  const use = () => void run(() => decks.activate(deck.id));
  const destroy = async () => {
    setConfirmDelete(false);
    const next = await run(() => decks.remove(deck.id));
    if (next !== null) {
      leaving.current = true;
      void navigate(base, { replace: true });
    }
  };

  const nameField = (
    <label className={`flex min-w-0 grow items-center rounded-10 px-2.5 shadow-ring-elevated ${desktop ? 'h-11 bg-sunken' : 'h-11 bg-panel'}`}>
      <input
        value={name}
        maxLength={40}
        aria-label={t('decks.deckName')}
        aria-invalid={!nameValid(name)}
        onChange={(event) => setName(event.target.value)}
        className={`h-10 min-w-0 grow bg-transparent font-display font-bold text-primary outline-none ${desktop ? 'text-18' : 'text-[17px]'}`}
      />
    </label>
  );

  const alerts = (
    <>
      {activeNeedsValid && dirty && (
        <InfoBox tone="gold" role="status" className="text-13">
          {t('decks.activeNeedsValid')}
        </InfoBox>
      )}
      {error !== undefined && (
        <InfoBox tone="danger" role="alert" className="text-13">
          {errorText(t, error)}
        </InfoBox>
      )}
      {confirmDelete && (
        <InfoBox tone="danger" role="group" aria-label={t('decks.delete')} data-delete-confirm className="flex flex-col gap-2.5">
          <p className="font-bold">{t('decks.deleteConfirm', { name: deck.name })}</p>
          <div className="flex gap-2.5">
            <Button variant="danger" size="sm" onClick={() => void destroy()}>
              {t('decks.deleteYes')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
              {t('decks.cancel')}
            </Button>
          </div>
        </InfoBox>
      )}
    </>
  );

  const leaveDialog = blocker.state === 'blocked' && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-app/70 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="deck-leave-title" className="flex w-full max-w-sm flex-col gap-3 rounded-16 bg-panel p-5 shadow-sheet">
        <h2 id="deck-leave-title" className="font-display text-18 font-bold">
          {t('decks.leaveTitle')}
        </h2>
        <p className="text-14 text-tertiary">{t('decks.leaveText')}</p>
        <div className="flex flex-wrap gap-2.5">
          <Button variant="danger" size="sm" onClick={() => blocker.proceed()}>
            {t('decks.leaveYes')}
          </Button>
          <Button variant="secondary" size="sm" autoFocus onClick={() => blocker.reset()}>
            {t('decks.stay')}
          </Button>
        </div>
      </div>
    </div>
  );

  if (desktop) {
    return (
      // Il pannello arriva a 20px dal bordo, come nella tavola: cinque colonne da 134px anche a 1440.
      <div className="-mr-5 grid grid-cols-[minmax(0,1fr)_400px] items-start gap-6">
        <section className="flex min-w-0 flex-col gap-4">
          <header className="flex h-11 items-center gap-4">
            <h1 className="font-display text-32 font-bold tracking-[0.02em]">{t('decks.title')}</h1>
            <span className="grow" />
            <span className="text-13 font-semibold text-muted">{t('decks.rules', { size: deckSize })}</span>
          </header>
          <div role="tablist" aria-label={t('decks.title')} className="flex gap-2 overflow-x-auto pb-1">
            {list.decks.map((d) => {
              const on = d.id === deck.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  role="tab"
                  data-deck={d.id}
                  aria-selected={on}
                  onClick={() => void navigate(`${base}/${d.id}`)}
                  className={`flex h-[52px] min-w-0 shrink-0 items-center gap-2.5 rounded-12 pr-3.5 pl-2 ${on ? 'bg-arcane-deep text-primary shadow-ring-arcane' : 'bg-sunken text-tertiary shadow-ring-elevated'}`}
                >
                  <DeckSigil sigil={on ? sigil : deckSigil(d.cards, byId)} size="md" />
                  <span className="flex min-w-0 flex-col items-start gap-px">
                    <span className="max-w-[110px] truncate font-display text-14 font-bold">{on ? name : d.name}</span>
                    <span className="flex items-center gap-1.5 text-12 font-bold">
                      <span className="opacity-75">{t('decks.count', { count: on ? total : d.size, size: deckSize })}</span>
                      {d.active && <ActivePill />}
                    </span>
                  </span>
                </button>
              );
            })}
            <NewDeckButton list={list} onClick={() => void newDeck()} className="h-[52px] shrink-0" />
          </div>
          <div className="flex items-baseline gap-3">
            <h2 className="text-12 font-extrabold tracking-[0.1em] text-muted uppercase">{t('decks.pool')}</h2>
            <span className="text-13 text-faint">{t('decks.poolHint')}</span>
          </div>
          <PoolFilters filters={filters} compact={false} onChange={(next) => setFilters((f) => ({ ...f, ...next }))} />
          <div className="pt-2.5">
            <PoolGrid items={pool} cards={cards} deckSize={deckSize} compact={false} onAdd={add} />
          </div>
        </section>

        <aside aria-label={name} className="sticky top-8 flex h-[calc(100dvh-4rem)] flex-col gap-3.5 rounded-16 bg-panel p-[18px]">
          <div className="flex items-center gap-3">
            <DeckSigil sigil={sigil} size="xl" />
            {nameField}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <span className="font-display text-24 font-extrabold text-gold-bright">{t('decks.countSpaced', { count: total, size: deckSize })}</span>
              <span className="text-13 font-semibold text-muted">{t('decks.cardsWord')}</span>
              <span className="grow" />
              <DeckStatusPill cards={cards} deckSize={deckSize} />
            </div>
            <DeckProgress cards={cards} deckSize={deckSize} />
          </div>
          <ManaCurve cards={cards} byId={byId} variant="desktop" />
          <ArchetypeChips cards={cards} byId={byId} />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={total >= deckSize}
              onClick={() => setCards((c) => autofill(c, items, deckSize, locale))}
              className="flex h-10 grow basis-0 items-center justify-center gap-1.5 rounded-10 bg-arcane-deep text-13 font-bold text-primary shadow-ring-arcane disabled:opacity-45"
            >
              <AppIcon name="spark" className="size-4" />
              {t('decks.autofill')}
            </button>
            <button
              type="button"
              onClick={() => setCards(new Map())}
              className="flex h-10 grow basis-0 items-center justify-center rounded-10 bg-elevated text-13 font-bold text-primary shadow-edge-elevated"
            >
              {t('decks.clear')}
            </button>
          </div>
          <div className="-mx-1 min-h-0 grow overflow-auto px-1">
            <DeckRows rows={rows} cards={cards} deckSize={deckSize} variant="desktop" onAdd={add} onRemove={remove} />
          </div>
          {alerts}
          <div className="flex gap-2">
            <Button size="md" data-action="save" disabled={!canSave} onClick={save} className="min-h-[52px] grow text-16 font-extrabold">
              {t('decks.save')}
            </Button>
            {deck.active ? (
              <span className="flex min-h-[52px] items-center px-2">
                <ActivePill />
              </span>
            ) : (
              <Button variant="secondary" size="md" data-action="use" disabled={!canUse} onClick={use} className="min-h-[52px]">
                {t('decks.use')}
              </Button>
            )}
          </div>
          <button
            type="button"
            data-action="delete"
            disabled={list.decks.length <= 1}
            onClick={() => setConfirmDelete(true)}
            className="self-center text-13 font-bold text-danger disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('decks.delete')}
          </button>
        </aside>
        {leaveDialog}
      </div>
    );
  }

  // Android: l'editor della tavola.
  return (
    <div className="flex flex-col gap-3.5 pb-20">
      <Link to={base} className="flex items-center gap-1 self-start text-13 font-bold text-muted">
        <AppIcon name="chevron" strokeWidth={2.2} className="size-4 rotate-180" />
        {t('decks.back')}
      </Link>
      <header className="flex items-center gap-2.5">
        <DeckSigil sigil={sigil} size="lg" />
        {nameField}
        <span className="font-display text-18 font-extrabold whitespace-nowrap text-gold-bright">{t('decks.countSpaced', { count: total, size: deckSize })}</span>
        <DeckMenu
          canUse={canUse}
          active={deck.active}
          canDelete={list.decks.length > 1}
          onUse={use}
          onDelete={() => setConfirmDelete(true)}
        />
      </header>
      <section className="flex flex-col gap-2.5 rounded-14 bg-panel px-3.5 py-3">
        <div className="flex items-center gap-2">
          <DeckProgress cards={cards} deckSize={deckSize} />
          <DeckStatusPill cards={cards} deckSize={deckSize} />
        </div>
        <ManaCurve cards={cards} byId={byId} variant="mobile" />
      </section>
      <div role="tablist" className="flex gap-1 rounded-12 bg-sunken p-1 shadow-ring-quiet">
        {EDITOR_TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`h-10 grow basis-0 rounded-9 text-14 font-bold ${tab === key ? 'bg-elevated text-primary' : 'text-muted'}`}
          >
            {key === 'deck' ? t('decks.tabDeck', { count: total, size: deckSize }) : t('decks.tabAdd')}
          </button>
        ))}
      </div>
      {tab === 'deck' ? (
        <DeckRows rows={rows} cards={cards} deckSize={deckSize} variant="mobile" onAdd={add} onRemove={remove} />
      ) : (
        <div className="flex flex-col gap-2.5">
          <PoolFilters filters={filters} compact onChange={(next) => setFilters((f) => ({ ...f, ...next }))} />
          <p className="text-12 font-semibold text-faint">{t('decks.tapHint')}</p>
          <PoolGrid items={pool} cards={cards} deckSize={deckSize} compact onAdd={add} />
        </div>
      )}
      {alerts}
      {/* Barra delle azioni sopra la barra inferiore, su fondo pieno: la griglia ci scorre sotto. */}
      <div className="fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-30 flex gap-2 bg-app px-4 pt-2 pb-3">
        <button
          type="button"
          disabled={total >= deckSize}
          onClick={() => setCards((c) => autofill(c, items, deckSize, locale))}
          className="flex h-[52px] items-center gap-1.5 rounded-10 bg-arcane-deep px-3.5 text-14 font-bold text-primary shadow-ring-arcane disabled:opacity-45"
        >
          <AppIcon name="spark" className="size-4" />
          {t('decks.autofill')}
        </button>
        <Button size="md" data-action="save" disabled={!canSave} onClick={save} className="min-h-[52px] grow text-16 font-extrabold">
          {t('decks.save')}
        </Button>
      </div>
      {leaveDialog}
    </div>
  );
}

/** Le due schede dell'editor Android. */
const EDITOR_TABS = ['deck', 'add'] as const;

/** Menu dell'editor Android (non disegnato, D11): «Usa in partita» ed «Elimina mazzo». */
function DeckMenu({
  canUse,
  active,
  canDelete,
  onUse,
  onDelete,
}: {
  canUse: boolean;
  active: boolean;
  canDelete: boolean;
  onUse(): void;
  onDelete(): void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t('decks.more')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex size-11 items-center justify-center rounded-10 bg-panel text-tertiary shadow-ring-elevated"
      >
        <AppIcon name="more" className="size-5" />
      </button>
      {open && (
        <div role="menu" className="absolute top-12 right-0 z-40 flex w-52 flex-col gap-1 rounded-12 bg-elevated p-1.5 shadow-card">
          {active ? (
            <span className="flex min-h-11 items-center px-3 text-14 font-bold text-valid-ink">{t('decks.isActive')}</span>
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled={!canUse}
              onClick={() => {
                setOpen(false);
                onUse();
              }}
              className="min-h-11 rounded-8 px-3 text-left text-14 font-bold text-primary hover:bg-panel disabled:opacity-45"
            >
              {t('decks.use')}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            disabled={!canDelete}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="min-h-11 rounded-8 px-3 text-left text-14 font-bold text-danger hover:bg-panel disabled:opacity-45"
          >
            {t('decks.delete')}
          </button>
        </div>
      )}
    </div>
  );
}
