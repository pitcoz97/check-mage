export const SCENARIO_NAMES = [
  /** Due client reali si accoppiano in matchmaking (default). */
  'pvp',
  /** Il bot (nero) cade nel matto del barbiere se il client gioca e4, Qh5, Bc4, Qxf7. */
  'checkmate',
  /** Il bot si disconnette dopo la sua prima mossa e non torna: fine per abbandono. */
  'abandon',
  /** Il bot si disconnette dopo la sua prima mossa e rientra entro la finestra di riconnessione. */
  'reconnect',
  /** Orologio breve; il bot non agisce mai e perde per tempo. */
  'timeout',
  /** Il bot offre patta al suo primo turno e accetta qualunque offerta. */
  'draw',
  /** Mana alto e mazzo del bot ordinato: il bot casta tutte e sei le magie nei primi turni. */
  'spells',
  /** Partita valida intercalata da frame malformati, type sconosciuti e payload inattesi. */
  'hostile',
  /** Il mock parla solo il contratto documentato, senza estensioni assunte: esercita i fallback. */
  'contract-minimal',
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];
