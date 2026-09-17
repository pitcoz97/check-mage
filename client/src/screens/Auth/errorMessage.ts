import type { TFunction } from 'i18next';

import type { HttpErrorInfo } from '../../api/types';

/** Messaggio tradotto per un errore REST. Il testo del server non viene mai mostrato. */
export function httpErrorMessage(t: TFunction, error: HttpErrorInfo): string {
  return error.code === null ? t('errors.unexpected') : t(`errors.http.${error.code}`);
}
