import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { LogoMark } from '../design/components/AppIcon';
import { Panel } from '../design/components/Panel';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { LegalLinks } from './LegalLinks';
import { LEGAL_DOCS, type LegalBlock, type LegalDocKey } from './types';
import { useLegalTexts } from './useLegal';

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === 'string') return <p>{block}</p>;
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5">
      {block.list.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * Un documento legale (P4): Informativa privacy, Termini, cancellazione dell'account, Crediti. Pagina pubblica,
 * raggiungibile anche senza account (serve per gli store e per chi legge prima di registrarsi). Non è nelle tavole:
 * il layout di login (D20) con un pannello largo da leggere.
 */
export function LegalPage({ doc }: { doc: LegalDocKey }) {
  const { t } = useTranslation();
  const texts = useLegalTexts();
  const document = texts[doc];
  return (
    <div className="safe-area flex min-h-full flex-col items-center gap-6 px-4 py-8">
      <Link to="/" className="flex items-center gap-3 text-primary">
        <LogoMark size="lg" />
        <span className="font-display text-24 font-extrabold tracking-[0.03em]">{t('app.name')}</span>
      </Link>
      <Panel className="w-full max-w-3xl rounded-16 p-6 lg:p-8">
        <article data-legal={doc} className="flex flex-col gap-6 text-15 leading-relaxed">
          <header className="flex flex-col gap-2">
            <h1 className="font-display text-28 font-bold tracking-[0.02em]">{document.title}</h1>
            <p className="text-muted">{document.intro}</p>
          </header>
          {document.sections.map((section) => (
            <section key={section.title} className="flex flex-col gap-2">
              <h2 className="font-display text-18 font-bold">{section.title}</h2>
              {section.body.map((block, index) => (
                <Block key={index} block={block} />
              ))}
            </section>
          ))}
        </article>
      </Panel>
      <nav aria-label={t('legal.title')} className="w-full max-w-3xl">
        <LegalLinks exclude={LEGAL_DOCS.filter((key) => key === doc)} />
      </nav>
      <div className="w-full max-w-sm">
        <LanguageSwitch showLabel={false} />
      </div>
    </div>
  );
}
