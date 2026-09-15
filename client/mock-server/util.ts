/** Log su stdout (niente console.log nel codice committato). */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

export function createLogger(quiet: boolean): Logger {
  const write = (level: string, message: string): void => {
    if (quiet) return;
    process.stdout.write(`[mock ${new Date().toISOString().slice(11, 19)}] ${level} ${message}\n`);
  };
  return { info: (m) => write('info', m), warn: (m) => write('warn', m) };
}

/** PRNG deterministico (mulberry32): mazzi e id ripetibili a parità di seed. */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = a;
  }
  return copy;
}

export function opaqueId(prefix: string, rng: Rng): string {
  return `${prefix}_${Math.floor(rng() * 0xffffffff).toString(16).padStart(8, '0')}`;
}
