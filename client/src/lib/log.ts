/**
 * Log diagnostico del client. Nessun `console.log` sparso nel codice (CLAUDE.md): tutto passa da qui.
 *
 * Il sink di default non scrive nulla; `main.tsx` attiva la console solo in sviluppo. Nei test il sink si inietta.
 * Il modulo non legge `import.meta.env`, così resta importabile anche dagli script Node (e2e).
 */

export type LogLevel = 'debug' | 'warn';

export type LogSink = (level: LogLevel, message: string, detail?: unknown) => void;

export interface Logger {
  debug(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
}

export function createLogger(sink: LogSink): Logger {
  return {
    debug: (message, detail) => sink('debug', message, detail),
    warn: (message, detail) => sink('warn', message, detail),
  };
}

/** L'unico accesso alla console del progetto: diagnostica del contratto col server, solo in sviluppo. */
export const consoleSink: LogSink = (level, message, detail) => {
  const args = detail === undefined ? [message] : [message, detail];
  // eslint-disable-next-line no-console -- sink di sviluppo del logger, attivato solo da main.tsx in DEV.
  if (level === 'warn') console.warn('[checkmage]', ...args);
  // eslint-disable-next-line no-console -- come sopra.
  else console.debug('[checkmage]', ...args);
};

let activeSink: LogSink = () => undefined;

/** Logger condiviso: scrive sul sink attivo al momento della chiamata. */
export const log: Logger = createLogger((level, message, detail) => activeSink(level, message, detail));

export function setLogSink(sink: LogSink): void {
  activeSink = sink;
}
