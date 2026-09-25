import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PlayedMove } from '../../game/model';
import { useCatalog } from '../../spells/CatalogProvider';
import { spellName, spellText } from '../../spells/texts';
import { useMatch } from '../../store/MatchProvider';
import type { LoggedSpell } from '../../store/matchStore';

/**
 * Schede della colonna laterale (tavola "Partita · desktop"): Mosse, Grimorio, Chat. Su Android le stesse schede
 * stanno nel foglio del Menu (D17).
 *
 * - **Mosse:** UCI come lo manda il server (D18; le mosse assorbite da uno scudo sono `--`), con le magie viste in
 *   questa sessione intercalate dove sono arrivate (D11, P2-18).
 * - **Grimorio:** il catalogo di tutte le magie, non il mazzo (informazione nascosta).
 * - **Chat:** visibile ma disattivata, «Presto» (D9).
 */

export type SideTab = 'moves' | 'grimoire' | 'chat';

export function SideTabs({ initialTab = 'moves', className = '' }: { initialTab?: SideTab; className?: string }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SideTab>(initialTab);
  const id = useId();
  const tabs: readonly { key: SideTab; label: string; disabled: boolean }[] = [
    { key: 'moves', label: t('match.tabs.moves'), disabled: false },
    { key: 'grimoire', label: t('match.tabs.grimoire'), disabled: false },
    { key: 'chat', label: t('match.tabs.chat'), disabled: true },
  ];

  return (
    <section aria-label={t('match.tabs.label')} className={`flex min-h-0 flex-col overflow-hidden rounded-12 bg-panel ${className}`}>
      <div role="tablist" className="flex shrink-0 border-b border-elevated">
        {tabs.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            id={`${id}-${entry.key}`}
            aria-selected={tab === entry.key}
            aria-controls={`${id}-panel`}
            aria-disabled={entry.disabled}
            data-tab={entry.key}
            onClick={() => {
              if (!entry.disabled) setTab(entry.key);
            }}
            className={`flex h-11 grow basis-0 items-center justify-center gap-1.5 border-b-[3px] text-14 ${
              tab === entry.key ? 'border-gold font-bold text-primary' : 'border-transparent font-semibold text-muted'
            } ${entry.disabled ? 'cursor-not-allowed' : ''}`}
          >
            {entry.label}
            {entry.disabled && <span className="rounded-pill bg-quiet px-1.5 py-px text-11 font-bold text-muted">{t('match.tabs.soon')}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {tab === 'moves' && <MoveList />}
        {tab === 'grimoire' && <Grimoire />}
        {tab === 'chat' && <p className="px-4 py-2 text-14 text-muted">{t('match.tabs.chatSoon')}</p>}
      </div>
    </section>
  );
}

type Row =
  | { readonly kind: 'move'; readonly number: number; readonly white: string; readonly black: string; readonly current: boolean; readonly absorbed: boolean }
  | { readonly kind: 'spell'; readonly spell: LoggedSpell };

function moveLabel(move: PlayedMove | undefined): string {
  if (move === undefined) return '';
  return move.kind === 'move' ? move.uci : '--';
}

/** Righe dello storico: coppie di mosse, con la mossa in corso segnata, e le magie dopo la mossa che le precede. */
function historyRows(moves: readonly PlayedMove[], spells: readonly LoggedSpell[], ongoing: boolean): Row[] {
  const rows: Row[] = [];
  let spellIndex = 0;
  const flushSpells = (upTo: number) => {
    while (spellIndex < spells.length && (spells[spellIndex]?.moveIndex ?? 0) <= upTo) {
      const spell = spells[spellIndex];
      if (spell !== undefined) rows.push({ kind: 'spell', spell });
      spellIndex += 1;
    }
  };
  flushSpells(0);
  for (let i = 0; i < moves.length; i += 2) {
    const white = moves[i];
    const black = moves[i + 1];
    const lastRow = i + 2 >= moves.length;
    rows.push({
      kind: 'move',
      number: i / 2 + 1,
      white: moveLabel(white),
      black: black === undefined && ongoing && lastRow ? '…' : moveLabel(black),
      current: ongoing && lastRow && black === undefined,
      absorbed: white?.kind === 'absorbed' || black?.kind === 'absorbed',
    });
    flushSpells(Math.min(i + 2, moves.length));
  }
  if (ongoing && moves.length % 2 === 0) {
    rows.push({ kind: 'move', number: moves.length / 2 + 1, white: '…', black: '', current: true, absorbed: false });
  }
  flushSpells(Number.POSITIVE_INFINITY);
  return rows;
}

function MoveList() {
  const { t } = useTranslation();
  const moves = useMatch((s) => s.game?.moves ?? []);
  const spells = useMatch((s) => s.spellLog);
  const ongoing = useMatch((s) => s.lifecycle === 'playing');
  const myColor = useMatch((s) => s.myColor);
  const players = useMatch((s) => s.game?.players ?? null);
  const byId = useCatalog((s) => s.byId);

  const rows = historyRows(moves, spells, ongoing);
  if (moves.length === 0 && spells.length === 0) return <p className="px-4 py-2 text-14 text-muted">{t('match.moveList.empty')}</p>;

  return (
    <ol data-history className="flex flex-col">
      {rows.map((row, index) =>
        row.kind === 'move' ? (
          <li
            key={`m${row.number}`}
            data-current-move={row.current || undefined}
            title={row.absorbed ? t('match.moveList.absorbed') : undefined}
            className={`grid h-[30px] grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)] items-center px-4 text-14 ${
              row.current ? 'bg-row-current' : row.number % 2 === 1 ? 'bg-row-stripe' : ''
            }`}
          >
            <span className="font-semibold text-faint">{row.number}.</span>
            <span className="font-semibold">{row.white}</span>
            <span className="font-semibold">{row.black}</span>
          </li>
        ) : (
          <li key={`s${row.spell.seq}-${index}`} data-history-spell className="mx-3 my-0.5 flex items-center gap-2 rounded-8 bg-spell-chip px-2.5 py-1.5 text-13">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3.5 shrink-0 text-arcane-bright" fill="currentColor">
              <path d="M12 3l1.8 4.6L18.5 9.5l-4.7 1.9L12 16l-1.8-4.6L5.5 9.5l4.7-1.9z" />
            </svg>
            <span className="font-bold text-arcane-bright">
              {row.spell.spellId === null ? t('spells.hiddenSpell') : spellName(t, byId.get(row.spell.spellId), row.spell.spellId)}
            </span>
            {row.spell.targets.length > 0 && <span className="text-muted">→ {row.spell.targets.join(' ')}</span>}
            <span className="grow" />
            <span className="text-12 text-faint">
              {row.spell.player === myColor ? t('match.you') : (players?.[row.spell.player].username ?? t('match.opponent'))}
            </span>
          </li>
        ),
      )}
    </ol>
  );
}

function Grimoire() {
  const { t } = useTranslation();
  const spells = useCatalog((s) => s.spells);
  if (spells.length === 0) return <p className="px-4 py-2 text-14 text-muted">{t('match.tabs.grimoireEmpty')}</p>;
  return (
    <ul data-grimoire className="flex flex-col gap-1 px-3 py-1">
      {spells.map((spell) => (
        <li key={spell.id} className="flex flex-col gap-1 rounded-8 px-2.5 py-2 odd:bg-row-stripe">
          <span className="flex items-center gap-2">
            <span className="font-display text-14 font-bold tracking-[0.02em]">{spellName(t, spell, spell.id)}</span>
            <span className="grow" />
            <span className="flex size-5 items-center justify-center rounded-full bg-gold text-12 font-extrabold text-on-gold shadow-edge-coin">
              {spell.manaCost}
            </span>
          </span>
          <span className="text-13 leading-[1.4] text-tertiary">{spellText(t, spell, spell.id).join(' ')}</span>
        </li>
      ))}
    </ul>
  );
}
