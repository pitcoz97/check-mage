import { decodeServerMessage, type DecodeOptions } from '../api/adapter';
import type { Logger } from '../lib/log';
import type { DecodeResult, ServerEvent } from './protocol';

/**
 * Instrada un frame del server verso lo store. Tutti gli eventi passano da qui e poi da `applyServerEvent`.
 *
 * Un frame che l'adapter non sa decodificare (JSON invalido, `type` sconosciuto, payload malformato) è un no-op
 * loggato: la partita continua con lo stato che aveva (briefing §11, Step 3). Non lancia mai eccezioni.
 * Restituisce l'esito della decodifica, per chi vuole contare warning e scarti (test, e2e).
 */
export interface EventSink {
  dispatch(event: ServerEvent): void;
}

export function routeFrame(raw: string, sink: EventSink, logger: Logger, options?: DecodeOptions): DecodeResult {
  const result = decodeServerMessage(raw, options);
  if (!result.ok) {
    logger.warn(`frame del server ignorato: ${result.failure.kind}`, result.failure);
    return result;
  }
  for (const warning of result.warnings) {
    logger.warn(`adapter [${warning.assumption}] ${warning.code}`, warning.detail);
  }
  sink.dispatch(result.event);
  return result;
}
