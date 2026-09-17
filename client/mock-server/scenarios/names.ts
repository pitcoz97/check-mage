export const SCENARIO_NAMES = [
  /** Due client reali si accoppiano in coda, come sul server (default). */
  'pvp',
  /** Il bot (nero) cade nel matto del barbiere se il client gioca e2e4, d1h5, f1c4, h5f7. */
  'checkmate',
  /** Il bot si disconnette dopo la sua prima mossa e non torna: fine per abbandono. */
  'abandon',
  /** Il bot si disconnette dopo la sua prima mossa e rientra entro la finestra di riconnessione. */
  'reconnect',
  /** Dopo la prima mossa del bot il "server" si riavvia: socket chiusi, partita dormiente fino al rientro. */
  'restart',
  /** Orologio breve; il bot non agisce mai e perde per tempo. */
  'timeout',
  /** Il bot offre patta al primo turno, rifiuta la prima offerta del client e accetta la seconda. */
  'draw',
  /** Mano e mazzo del bot preparati: casta tutti e sette i kind di effetto nei primi turni. */
  'spells',
  /** Partita valida intercalata da frame malformati, type sconosciuti e payload inattesi. */
  'hostile',
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];
