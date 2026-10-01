import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ManaCrystals } from '../../game/mana/ManaCrystals';
import type { Color, PieceKind, PlayerEffects, SpellId } from '../../game/model';
import { PieceIcon } from '../../game/pieces/PieceIcon';
import { useCatalog } from '../../spells/CatalogProvider';
import { auraIcon, triggerIcon } from '../../spells/effects.registry';
import { EffectIcon } from '../../spells/icons/EffectIcon';
import { spellName } from '../../spells/texts';
import { useApi } from '../../store/AuthProvider';
import { useMatch } from '../../store/MatchProvider';
import { Clock } from './Clock';

/** ELO pubblico del giocatore (`GET /users/{id}`): una sola richiesta per partita. */
function useElo(playerId: string | null): number | null {
  const api = useApi();
  const [elo, setElo] = useState<number | null>(null);
  useEffect(() => {
    if (playerId === null) return;
    let active = true;
    void api.fetchPublicProfile(playerId).then((result) => {
      if (active && result.ok) setElo(result.value.user.elo);
    });
    return () => {
      active = false;
    };
  }, [api, playerId]);
  return elo;
}

const NO_PIECES: readonly PieceKind[] = [];

/** Ordine del cimitero nella riga: prima i pezzi che valgono di più. */
const GRAVE_ORDER: readonly PieceKind[] = ['queen', 'rook', 'bishop', 'knight', 'pawn', 'king'];

/**
 * Cimitero del giocatore (ASSUMPTIONS §7, M15): i pezzi che ha perso, raggruppati per tipo col conteggio, come i
 * pezzi catturati dei siti di scacchi. Pubblico per entrambi; vuoto non occupa spazio.
 */
function Graveyard({ color }: { color: Color }) {
  const { t } = useTranslation();
  const pieces = useMatch((s) => s.game?.graveyards[color] ?? NO_PIECES);
  if (pieces.length === 0) return null;
  const groups = GRAVE_ORDER.map((kind) => ({ kind, count: pieces.filter((piece) => piece === kind).length })).filter(
    (group) => group.count > 0,
  );
  const list = groups.map((group) => t('spells.graveyard.count', { piece: t(`board.piece.${group.kind}`), count: group.count })).join(', ');
  return (
    <span
      data-graveyard={color}
      role="img"
      aria-label={t('spells.graveyard.label', { list })}
      className="flex shrink-0 items-center gap-1 text-12 font-bold text-muted"
    >
      {groups.map((group) => (
        <span key={group.kind} className="flex items-center">
          <span className="size-4 lg:size-5">
            <PieceIcon kind={group.kind} color={color} />
          </span>
          {group.count > 1 && <span aria-hidden="true">{group.count}</span>}
        </span>
      ))}
    </span>
  );
}

const NO_EFFECTS: PlayerEffects = { triggers: [], auras: [] };

/**
 * Trigger e aure del giocatore (Step 5): pillole compatte con l'icona di quello che fanno e i turni rimasti, il nome
 * nell'etichetta accessibile e nel title. Il proprio trigger ancora nascosto all'avversario è tratteggiato; un'aura
 * spenta è attenuata. Se l'aura è accesa lo dice il server. Su Android le pillole si impilano su due righe, per non
 * togliere spazio a nome e mana.
 */
function PlayerEffectChips({ color }: { color: Color }) {
  const { t } = useTranslation();
  const byId = useCatalog((s) => s.byId);
  const effects = useMatch((s) => s.game?.playerEffects ?? NO_EFFECTS);
  const triggers = effects.triggers.filter((trigger) => trigger.player === color);
  const auras = effects.auras.filter((aura) => aura.player === color);
  if (triggers.length === 0 && auras.length === 0) return null;
  const name = (id: SpellId | null) => (id === null ? t('spells.playerEffects.label') : spellName(t, byId.get(id), id));
  const pill = 'flex h-5 shrink-0 items-center gap-0.5 rounded-pill bg-panel px-1 text-12 font-bold text-muted lg:h-6 lg:px-1.5';

  return (
    <span role="group" aria-label={t('spells.playerEffects.label')} data-player-effects={color} className="grid shrink-0 grid-flow-col grid-rows-2 items-center gap-0.5 lg:flex lg:gap-1">
      {triggers.map((trigger, index) => {
        const base =
          trigger.remainingTurns < 0
            ? t('spells.playerEffects.triggerPermanent', { name: name(trigger.sourceSpellId) })
            : t(trigger.remainingTurns === 1 ? 'spells.playerEffects.triggerOne' : 'spells.playerEffects.triggerMany', {
                name: name(trigger.sourceSpellId),
                count: trigger.remainingTurns,
              });
        const label = trigger.hidden ? t('spells.playerEffects.hidden', { label: base }) : base;
        return (
          <span
            key={`t${index}`}
            role="img"
            aria-label={label}
            title={label}
            data-trigger={trigger.do}
            data-hidden={trigger.hidden}
            className={`${pill} ${trigger.hidden ? 'border border-dashed border-muted opacity-70' : ''}`}
          >
            <EffectIcon name={triggerIcon(trigger.do)} className="size-3.5" />
            {trigger.remainingTurns >= 0 && <span aria-hidden="true">{trigger.remainingTurns}</span>}
          </span>
        );
      })}
      {auras.map((aura, index) => {
        const label = aura.active
          ? t('spells.playerEffects.auraActive', { name: name(aura.sourceSpellId) })
          : t('spells.playerEffects.auraInactive', { name: name(aura.sourceSpellId), count: aura.minOwnPawns });
        return (
          <span
            key={`a${index}`}
            role="img"
            aria-label={label}
            title={label}
            data-aura={aura.grant}
            data-active={aura.active}
            className={`${pill} ${aura.active ? 'text-gold' : 'opacity-50'}`}
          >
            <EffectIcon name={auraIcon(aura.grant)} className="size-3.5" />
          </span>
        );
      })}
    </span>
  );
}

/**
 * Riga di un giocatore sopra o sotto la scacchiera (tavole della partita): avatar, nome con ELO, una riga secondaria
 * e l'orologio. Su desktop la riga secondaria dice quante carte restano nel grimorio (il nome del mazzo non esiste,
 * D10) e l'avversario ha i chip di mano e mana; su Android la riga secondaria porta mano e mana.
 *
 * Il mazzo avversario può restare indietro di una pesca fino al `game_state` successivo (ASSUMPTIONS C15).
 */
export function PlayerRow({ side }: { side: 'self' | 'opponent' }) {
  const { t } = useTranslation();
  const myColor = useMatch((s) => s.myColor);
  const players = useMatch((s) => s.game?.players ?? null);
  const handSizes = useMatch((s) => s.game?.handSizes ?? null);
  const deckSizes = useMatch((s) => s.game?.deckSizes ?? null);
  const myDeckSize = useMatch((s) => s.myDeckSize);
  const mana = useMatch((s) => s.game?.mana ?? null);
  const activePlayer = useMatch((s) => s.game?.activePlayer ?? null);
  const opponentConnected = useMatch((s) => s.opponentConnected);
  const playerEffects = useMatch((s) => s.game?.playerEffects ?? NO_EFFECTS);
  const friendly = useMatch((s) => s.game?.friendly === true);

  const color: Color = myColor === null ? (side === 'self' ? 'white' : 'black') : side === 'self' ? myColor : myColor === 'white' ? 'black' : 'white';
  const player = players?.[color] ?? null;
  const name = player?.username ?? t(side === 'self' ? 'match.you' : 'match.opponent');
  const elo = useElo(player?.id ?? null);
  const library = side === 'self' ? (myDeckSize ?? deckSizes?.[color] ?? null) : (deckSizes?.[color] ?? null);
  const myMana = mana?.[color] ?? null;
  const handSize = handSizes?.[color] ?? null;
  const disconnected = side === 'opponent' && !opponentConnected;
  // Su Android, con trigger o aure nella riga, il numero del mana lascia il posto alle pillole: restano i rombi.
  const hasEffects = [...playerEffects.triggers, ...playerEffects.auras].some((effect) => effect.player === color);

  return (
    <div data-player={side} data-active={activePlayer === color} className="flex h-11 items-center gap-2 lg:h-12 lg:gap-2.5">
      <span
        aria-hidden="true"
        className={`flex size-9 shrink-0 items-center justify-center rounded-8 text-15 font-extrabold lg:size-10 lg:text-16 ${
          side === 'self' ? 'bg-play text-on-play' : 'bg-arcane-deep text-arcane-pale'
        } ${disconnected ? 'opacity-40 grayscale' : ''}`}
      >
        {name.slice(0, 1).toUpperCase()}
      </span>

      <div className="flex min-w-0 flex-col gap-px lg:gap-0.5">
        <span className="flex items-baseline gap-1.5 truncate">
          <span className="text-14 font-bold lg:text-15">{name}</span>
          <span className="sr-only">{t(color === 'white' ? 'match.colorWhite' : 'match.colorBlack')}</span>
          {elo !== null && <span className="text-14 font-medium text-muted lg:text-13 lg:font-normal">{t('match.panel.eloShort', { elo })}</span>}
          {/* Amichevole (F8): accanto all'avversario, niente ELO in gioco. */}
          {side === 'opponent' && friendly && (
            <span data-friendly className="self-center rounded-pill bg-arcane-deep px-1.5 py-px text-11 font-bold text-arcane-pale">
              {t('match.friendly')}
            </span>
          )}
        </span>

        {/* Desktop: grimorio. */}
        <span className="hidden text-12 text-muted lg:flex lg:gap-1.5">
          {library !== null && <span>{t('match.panel.library', { count: library })}</span>}
          {disconnected && <span className="font-semibold text-danger">{t('match.panel.disconnected')}</span>}
        </span>

        {/* Android: mano e mana dell'avversario, i rombi per sé. */}
        <span className="flex items-center gap-2.5 text-12 font-semibold text-muted lg:hidden">
          {side === 'opponent' ? (
            <>
              {handSize !== null && (
                <span className="flex items-center gap-1">
                  <EffectIcon name="card" className="size-[13px]" />
                  <span aria-hidden="true">{handSize}</span>
                  <span className="sr-only">{t('match.panel.cards', { count: handSize })}</span>
                </span>
              )}
              {myMana !== null && (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-2 rotate-45 bg-gold" />
                  <span aria-hidden="true">{t('spells.manaShort', { ...myMana })}</span>
                  <span className="sr-only">{t('spells.mana', { ...myMana })}</span>
                </span>
              )}
            </>
          ) : (
            myMana !== null && (
              <span className="flex items-center gap-1.5">
                <span className="sr-only">{t('spells.mana', { ...myMana })}</span>
                <ManaCrystals current={myMana.current} max={myMana.max} size="sm" className="gap-[5px]" />
                <span aria-hidden="true" className={`font-bold text-gold-bright ${hasEffects ? 'hidden' : ''}`}>
                  {t('spells.manaShort', { ...myMana })}
                </span>
              </span>
            )
          )}
          {disconnected && <span className="text-danger">{t('match.panel.disconnected')}</span>}
        </span>
      </div>

      <span className="grow" />

      <PlayerEffectChips color={color} />
      <Graveyard color={color} />

      {/* Desktop: chip dell'avversario. */}
      {side === 'opponent' && (
        <span className="hidden items-center gap-2.5 lg:flex">
          {handSize !== null && (
            <span className="flex h-8 items-center gap-1.5 rounded-8 bg-panel px-2.5 text-13 font-bold">
              <EffectIcon name="card" className="size-4 text-muted" />
              <span aria-hidden="true">{handSize}</span>
              <span className="sr-only">{t('match.panel.cards', { count: handSize })}</span>
            </span>
          )}
          {myMana !== null && (
            <span className="flex h-8 items-center gap-2 rounded-8 bg-panel px-2.5 text-13 font-bold">
              <span aria-hidden="true" className="size-2.5 rotate-45 bg-gold shadow-glow-mana-chip" />
              <span aria-hidden="true">{t('spells.manaSpaced', { ...myMana })}</span>
              <span className="sr-only">{t('spells.mana', { ...myMana })}</span>
            </span>
          )}
        </span>
      )}

      <Clock side={side} color={color} active={activePlayer === color} name={player?.username ?? ''} />
    </div>
  );
}
