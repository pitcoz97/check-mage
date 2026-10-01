import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';

import { createJwtService } from './auth/jwt';
import { createTicketStore } from './auth/tickets';
import { configFromEnv, DEFAULT_CONFIG, type MockConfig } from './config';
import { RAW_CATALOG } from './game/catalog';
import { createRequestGate, createRestApp } from './rest/app';
import { createChallengeStore } from './store/challenges';
import { createCollectionStore } from './store/collection';
import { createDeckStore, type DeckStore } from './store/decks';
import { createPresenceStore } from './store/presence';
import { createUserStore } from './store/users';
import { createLogger } from './util';
import { createGateway } from './ws/gateway';

export interface MockServerHandle {
  readonly port: number;
  readonly httpUrl: string;
  readonly wsUrl: string;
  readonly config: MockConfig;
  /** Solo test ed e2e: per rendere non valido un mazzo attivo (`deck_invalid`). */
  readonly decks: DeckStore;
  close(): Promise<void>;
}

/** Avvia REST + WebSocket sulla stessa porta, come chess-server. `port: 0` sceglie una porta libera (test). */
export async function startMockServer(overrides: Partial<MockConfig> = {}): Promise<MockServerHandle> {
  const config: MockConfig = { ...DEFAULT_CONFIG, ...overrides };
  const log = createLogger(config.quiet);
  const users = createUserStore();
  const jwt = createJwtService({ accessSeconds: config.accessTokenTtlSeconds, refreshSeconds: config.refreshTokenTtlSeconds });
  const tickets = createTicketStore();
  const gate = createRequestGate(config, jwt, tickets);

  const collections = createCollectionStore(RAW_CATALOG, config.unlockAllCards);
  const decks = createDeckStore(collections);
  const presence = createPresenceStore(config.presenceWindowMs);
  const challenges = createChallengeStore(config.challengeTtlMs);
  const gateway = createGateway({ config, users, gate, log, decks, presence, challenges });
  const app = createRestApp(
    { config, users, jwt, tickets, catalog: RAW_CATALOG, collections, decks, presence, challenges, matches: gateway },
    gate,
  );
  const server = createServer(app);
  server.on('upgrade', (req, socket, head) => gateway.handleUpgrade(req, socket, head));

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  log.info(`in ascolto su http://localhost:${port} — scenario di default "${config.scenario}"`);

  return {
    port,
    httpUrl: `http://localhost:${port}`,
    wsUrl: `ws://localhost:${port}/ws`,
    config,
    decks,
    close: () =>
      new Promise<void>((resolve) => {
        gateway.close();
        challenges.dispose();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const handle = await startMockServer(configFromEnv());
  const stop = () => {
    void handle.close().then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
