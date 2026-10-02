import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { AppIcon } from '../../design/components/AppIcon';
import { Button } from '../../design/components/Button';
import { InfoBox } from '../../design/components/InfoBox';
import { Spinner } from '../../design/components/Spinner';
import { BOT_LEVELS } from '../../game/model';
import { useCatalog } from '../../spells/CatalogProvider';
import { useMatch, useMatchSession, useSessionStatus } from '../../store/MatchProvider';
import { BOT_COLOR_CHOICES } from '../../store/matchSession';
import { deckSigil } from '../Decks/deckEditor';
import { DeckSigil } from '../Decks/DeckSigil';
import { useDecks } from '../Decks/useDecks';
import { playChoiceStore, usePlayChoice, type PlayMode } from './playChoice';

const MODES = ['ranked', 'casual', 'bot'] as const;

const isPlayMode = (mode: (typeof MODES)[number]): mode is PlayMode => mode !== 'casual';

/** Pulsante di una scelta: selezionato (anello viola), disponibile, o «Presto» (spento). */
function optionClass(state: 'selected' | 'available' | 'soon'): string {
  if (state === 'selected') return 'bg-arcane-deep text-primary shadow-ring-arcane';
  if (state === 'available') return 'bg-sunken text-muted shadow-ring-elevated hover:text-primary';
  return 'cursor-not-allowed bg-sunken text-tertiary shadow-ring-elevated';
}

/**
 * Card "Gioca" della home (tavole "Home"). Classificata è la coda del server; Contro il bot apre la scelta di livello e
 * colore (B…); Amichevole resta «Presto» (D12, P2-21). La scelta si ricorda sul dispositivo. Le cadenze della tavola
 * non ci sono: il gioco resta a cadenza unica (D9). La riga «Mazzo attivo · Cambia» della tavola porta ai Mazzi (D12
 * dei mazzi).
 *
 * In coda la CTA lascia il posto allo stato della ricerca con Annulla: il box incassato con l'anello viola (D20).
 */
export function PlayCard({ wide }: { wide: boolean }) {
  const { t } = useTranslation();
  const session = useMatchSession();
  const lifecycle = useMatch((s) => s.lifecycle);
  const connection = useSessionStatus((s) => s.connection);
  // Una sfida diretta in attesa si mostra nel banner delle sfide, non qui (F7).
  const pending = useSessionStatus((s) => s.pending?.kind ?? null);
  const waiting = (pending === 'queue' || pending === 'bot') && lifecycle === 'queued';
  const choice = usePlayChoice();
  const modeLabel = useId();

  const stopped = connection.kind === 'replaced' || connection.kind === 'closed' || connection.kind === 'deck_invalid' || connection.kind === 'bot_unavailable';
  const searching = waiting && !stopped;
  const moved = waiting && connection.kind === 'replaced';
  const deckInvalid = waiting && connection.kind === 'deck_invalid';
  const botUnavailable = waiting && connection.kind === 'bot_unavailable';
  const play = () => (choice.mode === 'bot' ? session.playBot(choice.level, choice.color) : session.findMatch());

  return (
    <section data-play className={`flex grow flex-col gap-3 rounded-16 bg-panel p-[18px] lg:gap-3.5 lg:p-7 ${wide ? '' : 'lg:min-w-0'}`}>
      <div className="flex items-baseline gap-4">
        <h2 className="font-display text-28 leading-none font-extrabold tracking-[0.02em] lg:text-36">{t('nav.play')}</h2>
        <p className="hidden text-15 text-muted lg:block">{t('home.tagline')}</p>
      </div>

      <div className="flex flex-col gap-2">
        <span id={modeLabel} className="hidden text-12 font-extrabold tracking-[0.1em] text-muted uppercase lg:block">
          {t('home.mode')}
        </span>
        <div role="group" aria-labelledby={modeLabel} className="flex gap-1.5 lg:gap-2">
          {MODES.map((mode) => {
            const available = isPlayMode(mode);
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={available && choice.mode === mode}
                aria-disabled={!available}
                data-mode={mode}
                onClick={() => {
                  if (isPlayMode(mode) && !searching) void playChoiceStore.getState().update({ mode });
                }}
                className={`flex h-11 grow basis-0 items-center justify-center gap-1.5 rounded-10 text-13 font-bold lg:h-12 lg:text-15 ${optionClass(
                  !available ? 'soon' : choice.mode === mode ? 'selected' : 'available',
                )}`}
              >
                {t(`home.modes.${mode}`)}
                {/* Su Android la pillola non ci sta: resta il testo per i lettori di schermo. */}
                {!available && <span className="hidden rounded-pill bg-quiet px-1.5 py-px text-11 font-bold text-muted lg:inline">{t('nav.soon')}</span>}
                {!available && <span className="sr-only lg:hidden">{t('nav.soon')}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {choice.mode === 'bot' && <BotOptions disabled={searching} />}

      <span className="hidden grow lg:block" />

      <ActiveDeckRow />

      {searching ? (
        <InfoBox tone="arcane" data-queue className="flex min-h-15 items-center gap-3 lg:min-h-[68px]" aria-live="polite">
          <span className="grow font-semibold">
            <Spinner label={connection.kind === 'reconnecting' ? t('lobby.searchingReconnect') : pending === 'bot' ? t('lobby.startingBot') : t('lobby.searching')} />
          </span>
          <Button variant="secondary" size="sm" onClick={() => session.cancel()}>
            {t('lobby.cancel')}
          </Button>
        </InfoBox>
      ) : (
        <div className="flex flex-col gap-2">
          {moved && (
            <InfoBox tone="gold" role="status">
              {t('lobby.searchMoved')}
            </InfoBox>
          )}
          {botUnavailable && (
            <InfoBox tone="danger" role="alert" data-bot-unavailable>
              {t('lobby.botUnavailable')}
            </InfoBox>
          )}
          {deckInvalid && (
            <InfoBox tone="danger" role="alert" data-deck-invalid className="flex flex-wrap items-center gap-2.5">
              <span className="grow">{t('decks.invalidDeck')}</span>
              <Link to="/decks" className="text-14 font-bold text-gold">
                {t('decks.fixDeck')}
              </Link>
            </InfoBox>
          )}
          <Button size="hero" fullWidth data-action="play" onClick={play} className="gap-3">
            <AppIcon name="play" strokeWidth={2} className="hidden size-[26px] lg:block" />
            {moved ? t('lobby.retry') : choice.mode === 'bot' ? t('home.playBot') : t('home.playRanked')}
          </Button>
        </div>
      )}
    </section>
  );
}

/** Livello e colore della partita contro il bot: due gruppi di pulsanti come quello della modalità. */
function BotOptions({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const choice = usePlayChoice();
  const levelLabel = useId();
  const colorLabel = useId();
  const button = 'flex h-10 grow basis-0 items-center justify-center rounded-10 text-13 font-bold lg:h-11 lg:text-14';
  return (
    <div data-bot-options className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1.5">
        <span id={levelLabel} className="text-12 font-extrabold tracking-[0.1em] text-muted uppercase">
          {t('home.botLevel')}
        </span>
        <div role="group" aria-labelledby={levelLabel} className="flex gap-1.5 lg:gap-2">
          {BOT_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={choice.level === level}
              disabled={disabled}
              data-bot-level={level}
              onClick={() => void playChoiceStore.getState().update({ level })}
              className={`${button} ${optionClass(choice.level === level ? 'selected' : 'available')}`}
            >
              {t(`bot.levels.${level}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span id={colorLabel} className="text-12 font-extrabold tracking-[0.1em] text-muted uppercase">
          {t('home.botColor')}
        </span>
        <div role="group" aria-labelledby={colorLabel} className="flex gap-1.5 lg:gap-2">
          {BOT_COLOR_CHOICES.map((color) => (
            <button
              key={color}
              type="button"
              aria-pressed={choice.color === color}
              disabled={disabled}
              data-bot-color={color}
              onClick={() => void playChoiceStore.getState().update({ color })}
              className={`${button} ${optionClass(choice.color === color ? 'selected' : 'available')}`}
            >
              {t(`home.botColors.${color}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Riga «Mazzo attivo» della tavola: sigillo, nome e «Cambia» verso i Mazzi. Finché la lista non c'è, niente riga. */
function ActiveDeckRow() {
  const { t } = useTranslation();
  const { state } = useDecks();
  const byId = useCatalog((s) => s.byId);
  const active = state.kind === 'ready' ? state.list.decks.find((deck) => deck.active) : undefined;
  if (active === undefined) return null;
  return (
    <div data-active-deck={active.id} className="flex h-15 items-center gap-3.5 rounded-12 bg-sunken pr-4 pl-2.5 shadow-ring-elevated lg:h-16">
      <DeckSigil sigil={deckSigil(active.cards, byId)} size="xl" />
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className="truncate font-display text-[17px] font-bold">{active.name}</span>
        <span className="text-13 text-muted">{t('decks.activeDeck')}</span>
      </span>
      <Link to="/decks" className="text-14 font-bold text-gold hover:text-gold-bright">
        {t('decks.change')}
      </Link>
    </div>
  );
}
