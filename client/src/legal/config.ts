/**
 * Dati legali da compilare PRIMA di andare online (docs/legal/README.md). Sono gli unici valori dei testi legali che
 * cambiano da un'installazione all'altra: titolare, contatto, dove gira il server. `npm run legal:check` (e la build
 * del deploy) falliscono finché resta un segnaposto tra parentesi quadre.
 *
 * I testi (texts.it.ts, texts.en.ts) sono bozze scritte a partire dal codice reale: falli rileggere a un
 * professionista prima della pubblicazione.
 */

/** Dove gira il server: cambia i fornitori elencati nell'informativa. */
export type Hosting =
  /** Server privato virtuale: il provider tratta i dati per conto del titolare (art. 28 GDPR). */
  | { readonly kind: 'vps'; readonly provider: string; readonly country: string }
  /** Computer del titolare, esposto su internet con Cloudflare Tunnel (docs/DEPLOY-CASA.md). */
  | { readonly kind: 'home' };

/** Dove arriva la posta dell'indirizzo di contatto: cambia destinatari e trasferimenti elencati nell'informativa. */
export type ContactMail =
  /** Indirizzo inoltrato da Cloudflare Email Routing a una casella Gmail. */
  | { readonly kind: 'cloudflare-gmail' }
  /** Casella fornita direttamente da un provider di posta. */
  | { readonly kind: 'mailbox'; readonly provider: string; readonly country: string };

export interface LegalConfig {
  /** Nome e cognome del titolare del trattamento (persona fisica) o ragione sociale. */
  readonly owner: string;
  /** Email per privacy, segnalazioni e richieste degli utenti: meglio un indirizzo dedicato. */
  readonly contactEmail: string;
  readonly contactMail: ContactMail;
  readonly hosting: Hosting;
  /** Data di entrata in vigore dei testi correnti, AAAA-MM-GG. */
  readonly effectiveDate: string;
}

export const LEGAL_CONFIG: LegalConfig = {
  owner: 'Riccardo Picozzi',
  contactEmail: 'info@check-mage.com',
  contactMail: { kind: 'cloudflare-gmail' },
  hosting: { kind: 'home' },
  effectiveDate: '2026-10-02',
};

/**
 * Versione di Informativa e Termini: va alzata a ogni modifica sostanziale dei testi, insieme a `TermsVersion` del
 * server (`internal/handlers/privacy.go`). Chi ha accettato una versione precedente deve riaccettare (P2).
 */
export const TERMS_VERSION = 1;

/** Età minima per registrarsi senza il consenso dei genitori in Italia (D.Lgs. 101/2018, art. 2-quinquies). */
export const MINIMUM_AGE = 14;

/** Giorni di conservazione dei backup del database (`deploy/backup.sh`). */
export const BACKUP_RETENTION_DAYS = 14;

/** Segnaposto rimasti nella configurazione: vuoto = pronta per la pubblicazione. */
export function unfilledPlaceholders(config: LegalConfig = LEGAL_CONFIG): string[] {
  const values = [
    config.owner,
    config.contactEmail,
    config.effectiveDate,
    ...(config.contactMail.kind === 'mailbox' ? [config.contactMail.provider, config.contactMail.country] : []),
    ...(config.hosting.kind === 'vps' ? [config.hosting.provider, config.hosting.country] : []),
  ];
  return values.filter((value) => /\[[^\]]*\]/.test(value) || value.trim() === '');
}
