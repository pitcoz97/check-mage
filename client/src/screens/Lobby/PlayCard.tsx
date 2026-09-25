import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon } from '../../design/components/AppIcon';
import { Button } from '../../design/components/Button';
import { InfoBox } from '../../design/components/InfoBox';
import { Spinner } from '../../design/components/Spinner';
import { useMatch, useMatchSession, useSessionStatus } from '../../store/MatchProvider';

/**
 * Card "Gioca" della home (tavole "Home"). La modalità reale è una sola, la coda classificata del server: Amichevole
 * e Contro il bot si vedono ma sono «Presto» (D12, P2-21). Cadenze e riga del mazzo della tavola non ci sono: il
 * gioco resta a cadenza unica e il mazzo non ha un nome (D9, D10).
 *
 * In coda la CTA lascia il posto allo stato della ricerca con Annulla: il box incassato con l'anello viola (D20).
 */

const MODES = ['ranked', 'casual', 'bot'] as const;

export function PlayCard({ wide }: { wide: boolean }) {
  const { t } = useTranslation();
  const session = useMatchSession();
  const lifecycle = useMatch((s) => s.lifecycle);
  const connection = useSessionStatus((s) => s.connection);
  const modeLabel = useId();

  const searching = lifecycle === 'queued' && connection.kind !== 'replaced' && connection.kind !== 'closed';
  const moved = lifecycle === 'queued' && connection.kind === 'replaced';

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
            const available = mode === 'ranked';
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={available}
                aria-disabled={!available}
                data-mode={mode}
                className={`flex h-11 grow basis-0 items-center justify-center gap-1.5 rounded-10 text-13 font-bold lg:h-12 lg:text-15 ${
                  available ? 'bg-arcane-deep text-primary shadow-ring-arcane' : 'cursor-not-allowed bg-sunken text-tertiary shadow-ring-elevated'
                }`}
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

      <span className="hidden grow lg:block" />

      {searching ? (
        <InfoBox tone="arcane" data-queue className="flex min-h-15 items-center gap-3 lg:min-h-[68px]" aria-live="polite">
          <span className="grow font-semibold">
            <Spinner label={connection.kind === 'reconnecting' ? t('lobby.searchingReconnect') : t('lobby.searching')} />
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
          <Button size="hero" fullWidth data-action="play" onClick={() => session.findMatch()} className="gap-3">
            <AppIcon name="play" strokeWidth={2} className="hidden size-[26px] lg:block" />
            {moved ? t('lobby.retry') : t('home.playRanked')}
          </Button>
        </div>
      )}
    </section>
  );
}
