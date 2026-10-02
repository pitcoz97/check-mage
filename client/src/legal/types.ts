import type { Hosting } from './config';

/** Un blocco di testo: un paragrafo o un elenco puntato. */
export type LegalBlock = string | { readonly list: readonly string[] };

export interface LegalSection {
  readonly title: string;
  readonly body: readonly LegalBlock[];
}

export interface LegalDocument {
  readonly title: string;
  readonly intro: string;
  readonly sections: readonly LegalSection[];
}

export const LEGAL_DOCS = ['privacy', 'terms', 'accountDeletion', 'credits'] as const;
export type LegalDocKey = (typeof LEGAL_DOCS)[number];

export type LegalTexts = Readonly<Record<LegalDocKey, LegalDocument>>;

/** I valori della configurazione già pronti da inserire nei testi. */
export interface LegalContext {
  readonly owner: string;
  readonly email: string;
  readonly hosting: Hosting;
  /** Data di entrata in vigore, già formattata nella lingua. */
  readonly effectiveDate: string;
  readonly minimumAge: number;
  readonly backupDays: number;
}
