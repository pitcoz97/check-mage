import type { AppIconName } from '../design/components/AppIcon';

/**
 * Voci di navigazione delle tavole, uniche per tutte le barre (laterale, verticale della partita, inferiore Android).
 * Quelle senza una rotta sono funzioni che il server non ha: visibili ma disattivate, «Presto» (REDESIGN_PLAN.md D9,
 * BACKEND-REQUESTS P2-21).
 */
export interface NavItem {
  readonly key: 'play' | 'decks' | 'collection' | 'ranking' | 'friends';
  readonly icon: AppIconName;
  /** `null` = «Presto». */
  readonly to: string | null;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'play', icon: 'play', to: '/lobby' },
  { key: 'decks', icon: 'decks', to: null },
  { key: 'collection', icon: 'collection', to: null },
  { key: 'ranking', icon: 'ranking', to: '/leaderboard' },
  { key: 'friends', icon: 'friends', to: null },
];
