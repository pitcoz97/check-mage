import { describe, expect, it } from 'vitest';

import { unfilledPlaceholders, type LegalConfig } from './config';
import { LEGAL_DOCS } from './types';
import { legalTexts } from './useLegal';

const filled: LegalConfig = {
  owner: 'Mario Rossi',
  contactEmail: 'privacy@esempio.it',
  contactMail: { kind: 'mailbox', provider: 'Aruba S.p.A.', country: 'Italia' },
  hosting: { kind: 'vps', provider: 'Hetzner Online GmbH', country: 'Germania' },
  effectiveDate: '2026-10-02',
};

const text = (config: LegalConfig, language: string) => JSON.stringify(legalTexts(language, config));

describe('testi legali (P4)', () => {
  it('tutti i documenti in italiano e in inglese, con titolare, contatto e data', () => {
    for (const language of ['it', 'en']) {
      const texts = legalTexts(language, filled);
      for (const doc of LEGAL_DOCS) {
        expect(texts[doc].title).not.toBe('');
        expect(texts[doc].sections.length).toBeGreaterThan(0);
      }
      expect(JSON.stringify(texts.privacy)).toContain('Mario Rossi');
      expect(JSON.stringify(texts.privacy)).toContain('privacy@esempio.it');
    }
    expect(legalTexts('it', filled).privacy.intro).toContain('2 ottobre 2026');
    expect(legalTexts('en', filled).privacy.intro).toContain('2 October 2026');
  });

  it('i fornitori seguono l’hosting: provider della VPS oppure Cloudflare', () => {
    expect(text(filled, 'it')).toContain('Hetzner Online GmbH');
    expect(text(filled, 'it')).not.toContain('Cloudflare');
    const home: LegalConfig = { ...filled, hosting: { kind: 'home' } };
    expect(text(home, 'it')).toContain('Cloudflare, Inc.');
    expect(text(home, 'en')).toContain('Data Privacy Framework');
  });

  it('la posta di contatto segue la configurazione: casella diretta oppure inoltro Cloudflare a Gmail', () => {
    expect(text(filled, 'it')).toContain('Aruba S.p.A.');
    expect(text(filled, 'it')).not.toContain('Gmail');
    const forwarded: LegalConfig = { ...filled, contactMail: { kind: 'cloudflare-gmail' } };
    for (const language of ['it', 'en']) {
      expect(text(forwarded, language)).toContain('Email Routing');
      expect(text(forwarded, language)).toContain('Gmail');
      expect(text(forwarded, language)).toContain('Google LLC');
    }
  });

  it('i segnaposto vanno compilati prima di pubblicare', () => {
    const blank: LegalConfig = { ...filled, owner: '[NOME E COGNOME]', contactEmail: '[EMAIL DI CONTATTO]' };
    expect(unfilledPlaceholders(blank)).toEqual(['[NOME E COGNOME]', '[EMAIL DI CONTATTO]']);
    expect(unfilledPlaceholders(filled)).toEqual([]);
    expect(unfilledPlaceholders({ ...filled, contactMail: { kind: 'mailbox', provider: '[FORNITORE]', country: 'Italia' } })).toEqual(['[FORNITORE]']);
    expect(unfilledPlaceholders({ ...filled, hosting: { kind: 'home' }, owner: ' ' })).toEqual([' ']);
  });
});
