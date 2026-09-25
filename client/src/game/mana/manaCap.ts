/**
 * Tetto del mana: `MaxManaCap` nel server (`spells/spells.go:22`), che non lo manda nel protocollo (ASSUMPTIONS C16,
 * BACKEND-REQUESTS P2-17). Serve solo al disegno dei rombi bloccati, mai a una decisione di gioco.
 */
export const MANA_CAP = 10;

export type CrystalState = 'on' | 'spent' | 'locked';

/**
 * Stato di ogni rombo, come nelle tavole: accesi fino al mana corrente, spesi fino al massimo del turno, bloccati
 * oltre. Un mana corrente sopra il massimo (magie che ne danno) accende i rombi anche oltre, entro il tetto.
 */
export function crystalStates(current: number, max: number, cap: number = MANA_CAP): CrystalState[] {
  return Array.from({ length: cap }, (_, index) => (index < current ? 'on' : index < max ? 'spent' : 'locked'));
}
