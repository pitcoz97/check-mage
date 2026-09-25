import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ManaCrystals } from '../../game/mana/ManaCrystals';
import type { Color, PieceKind } from '../../game/model';
import { PieceIcon } from '../../game/pieces/PieceIcon';
import { EffectIcon } from '../../spells/icons/EffectIcon';
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

  const color: Color = myColor === null ? (side === 'self' ? 'white' : 'black') : side === 'self' ? myColor : myColor === 'white' ? 'black' : 'white';
  const player = players?.[color] ?? null;
  const name = player?.username ?? t(side === 'self' ? 'match.you' : 'match.opponent');
  const elo = useElo(player?.id ?? null);
  const library = side === 'self' ? (myDeckSize ?? deckSizes?.[color] ?? null) : (deckSizes?.[color] ?? null);
  const myMana = mana?.[color] ?? null;
  const handSize = handSizes?.[color] ?? null;
  const disconnected = side === 'opponent' && !opponentConnected;

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
                <span aria-hidden="true" className="font-bold text-gold-bright">
                  {t('spells.manaShort', { ...myMana })}
                </span>
              </span>
            )
          )}
          {disconnected && <span className="text-danger">{t('match.panel.disconnected')}</span>}
        </span>
      </div>

      <span className="grow" />

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
