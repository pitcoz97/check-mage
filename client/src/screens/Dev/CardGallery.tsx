import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../design/components/Button';
import { Panel } from '../../design/components/Panel';
import { SpellCard } from '../../game/hand/SpellCard';
import { useCatalog } from '../../spells/CatalogProvider';
import { cardRefusal, type CastContext } from '../../spells/playability';

/**
 * Pagina di sviluppo (`/dev/cards`, briefing §5.1.9): tutte le carte del catalogo in griglia, nei loro stati.
 * Serve a valutare bilanciamento e leggibilità senza avviare una partita. Non esiste nella build di produzione.
 */

const READY: CastContext = { playing: true, connected: true, myTurn: true, phase: 'main1', mana: 99, castPending: false };

const STATES = [
  { key: 'playable', context: READY, selected: false },
  { key: 'mana', context: { ...READY, mana: 0 }, selected: false },
  { key: 'phase', context: { ...READY, phase: 'move' }, selected: false },
  { key: 'targeting', context: READY, selected: true },
] as const satisfies readonly { key: string; context: CastContext; selected: boolean }[];

type StateKey = (typeof STATES)[number]['key'];

function stateLabel(key: StateKey, t: ReturnType<typeof useTranslation>['t']): string {
  if (key === 'playable') return t('spells.dev.state.playable');
  if (key === 'mana') return t('spells.dev.state.mana');
  if (key === 'phase') return t('spells.dev.state.phase');
  return t('spells.dev.state.targeting');
}

export function CardGallery() {
  const { t } = useTranslation();
  const spells = useCatalog((s) => s.spells);
  const source = useCatalog((s) => s.source);
  const [active, setActive] = useState<StateKey>('playable');
  const current = STATES.find((state) => state.key === active) ?? STATES[0];

  return (
    <div className="safe-area mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <h1 className="text-28 font-bold">{t('spells.dev.title')}</h1>
      <Panel className="flex flex-wrap items-center gap-2 p-3 text-14">
        <span className="text-muted">{t('spells.dev.source', { source: source ?? '…', count: spells.length })}</span>
        <span role="group" aria-label={t('spells.dev.stateLabel')} className="ml-auto flex flex-wrap gap-2">
          {STATES.map((state) => (
            <Button
              key={state.key}
              variant={state.key === active ? 'primary' : 'secondary'}
              onClick={() => setActive(state.key)}
            >
              {stateLabel(state.key, t)}
            </Button>
          ))}
        </span>
      </Panel>

      <div className="flex flex-wrap gap-3">
        {spells.map((spell) => (
          <SpellCard
            key={spell.id}
            spell={spell}
            spellId={spell.id}
            refusal={cardRefusal(spell, current.context)}
            selected={current.selected}
          />
        ))}
        {/* Anche il caso peggiore: una magia che il client non conosce. */}
        <SpellCard spell={undefined} spellId="spell_sconosciuta_dal_nome_lungo" refusal="unknown_spell" />
      </div>
    </div>
  );
}
