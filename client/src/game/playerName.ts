import type { TFunction } from 'i18next';

import type { BotIdentity, PlayerRef } from './model';

/** Nome di un bot: «Bot · livello», o solo «Bot» se il livello non si conosce. */
export function botName(t: TFunction, bot: BotIdentity): string {
  return bot === 'unknown' ? t('bot.unknown') : t('bot.name', { level: t(`bot.levels.${bot}`) });
}

/** Il nome da mostrare per un giocatore: per il bot quello tradotto, mai l'username del suo account. */
export function playerName(t: TFunction, player: PlayerRef): string {
  return player.bot === undefined ? player.username : botName(t, player.bot);
}
