import 'i18next';

import type { resources } from './index';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    // Le chiavi derivano dalla risorsa italiana: `t('chiave.inesistente')` non compila.
    resources: (typeof resources)['it'];
    returnNull: false;
  }
}
