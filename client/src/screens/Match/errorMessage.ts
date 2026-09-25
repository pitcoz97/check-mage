import type { TFunction } from 'i18next';

import type { Color, ProtocolErrorInfo } from '../../game/model';
import type { PickupRefusal } from '../../game/board/selection';

/**
 * Messaggi per i rifiuti: quelli del server (codice + dettagli, `gameerr/gameerr.go`) e quelli decisi prima di
 * disturbarlo (pickup non consentito). Il testo del server non viene mai mostrato.
 */

/** Il nome della fase, localizzato: nei messaggi non compare mai il valore grezzo. */
function phaseName(t: TFunction, phase: ProtocolErrorInfo['phase']): string {
  return t(`match.phase.${phase ?? 'unknown'}`);
}

/** Motivi di `invalid_target` che il client sa spiegare (`effects/targets.go`); gli altri restano generici. */
const TARGET_REASONS = [
  'off_board',
  'duplicate',
  'not_empty',
  'no_piece',
  'wrong_owner',
  'king',
  'piece_kind',
  'missing_effect',
  'too_far',
  'rank',
  'max_pawns',
  'promotion',
  'pawn_rank',
  'wall',
  'no_capture',
] as const;
type TargetReason = (typeof TARGET_REASONS)[number];

function isTargetReason(reason: string | null): reason is TargetReason {
  return reason !== null && (TARGET_REASONS as readonly string[]).includes(reason);
}

/** Motivi di `no_effect` e di `invalid_choice` (`game/room.go`, applySpellEffects). */
const NO_EFFECT_REASONS = ['no_pieces', 'empty_graveyard', 'no_castling', 'no_runes'] as const;
const CHOICE_REASONS = ['missing', 'not_allowed'] as const;
/** Motivi di `move_blocked` (`effects/squares.go`). */
const BLOCK_REASONS = ['wall', 'no_capture'] as const;

function isOneOfReasons<T extends string>(list: readonly T[], reason: string | null): reason is T {
  return reason !== null && (list as readonly string[]).includes(reason);
}

/** `myColor` distingue lo scacco al proprio re da quello dato all'avversario (`illegal_position`). */
export function protocolErrorMessage(t: TFunction, info: ProtocolErrorInfo, myColor: Color | null = null): string {
  if (info.code === 'invalid_target' && isTargetReason(info.reason)) return t(`match.error.target.${info.reason}`);
  if (info.code === 'no_effect' && isOneOfReasons(NO_EFFECT_REASONS, info.reason)) return t(`match.error.noEffect.${info.reason}`);
  if (info.code === 'invalid_choice' && isOneOfReasons(CHOICE_REASONS, info.reason)) return t(`match.error.choice.${info.reason}`);
  if (info.code === 'move_blocked' && isOneOfReasons(BLOCK_REASONS, info.reason)) {
    return t(`match.error.moveBlocked.${info.reason}`, { square: info.square ?? '' });
  }
  if (info.code === 'illegal_position' && info.king !== null && myColor !== null) {
    return t(info.king === myColor ? 'match.error.illegalPositionOwnKing' : 'match.error.illegalPositionCheck');
  }
  if (info.code === 'limit_reached' && info.perTurn === 1) return t('match.error.limitReachedOnce');
  const params = {
    perTurn: info.perTurn ?? 0,
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
