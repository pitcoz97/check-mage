import type { TFunction } from 'i18next';

import type { ProtocolErrorInfo } from '../../game/model';
import type { PickupRefusal } from '../../game/board/selection';

/**
 * Messaggi per i rifiuti: quelli del server (codice + dettagli, `gameerr/gameerr.go`) e quelli decisi prima di
 * disturbarlo (pickup non consentito). Il testo del server non viene mai mostrato.
 */

/** Il nome della fase, localizzato: nei messaggi non compare mai il valore grezzo. */
function phaseName(t: TFunction, phase: ProtocolErrorInfo['phase']): string {
  return t(`match.phase.${phase ?? 'unknown'}`);
}

export function protocolErrorMessage(t: TFunction, info: ProtocolErrorInfo): string {
  const params = {
    phase: phaseName(t, info.phase),
    square: info.square ?? '',
    needed: info.needed ?? 0,
    available: info.available ?? 0,
    expected: info.expected ?? 0,
    received: info.received ?? 0,
  };
  return info.code === null ? t('match.error.generic', params) : t(`match.error.${info.code}`, params);
}

export function refusalMessage(t: TFunction, reason: PickupRefusal): string {
  return t(`match.refusal.${reason}`);
}
