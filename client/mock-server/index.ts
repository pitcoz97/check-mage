import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';

import { createJwtService } from './auth/jwt';
import { createTicketStore } from './auth/tickets';
import { configFromEnv, DEFAULT_CONFIG, type MockConfig } from './config';
import { RAW_CATALOG } from './game/catalog';
import { createRestApp } from './rest/app';
import { createUserStore } from './store/users';
import { createLogger } from './util';
import { createGateway } from './ws/gateway';

export interface MockServerHandle {
  readonly port: number;
  readonly httpUrl: string;
  readonly wsUrl: string;
  close(): Promise<void>;
}

/** Avvia REST + WebSocket sulla stessa porta. `port: 0` sceglie una porta libera (test). */
export async function startMockServer(overrides: Partial<MockConfig> = {}): Promise<MockServerHandle> {
  const config: MockConfig = { ...DEFAULT_CONFIG, ...overrides };
  const log = createLogger(config.quiet);
  const users = createUserStore();
  const jwt = createJwtService(config.jwtTtlSeconds);
  const tickets = createTicketStore(config.ticketTtlSeconds);

  const app = createRestApp({ config, users, jwt, tickets, catalog: RAW_CATALOG });
  const gateway = createGateway({ config, users, tickets, log });
  const server = createServer(app);
  server.on('upgrade', (req, socket, head) => gateway.handleUpgrade(req, socket, head));

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  log.info(`in ascolto su http://localhost:${port} (scenario di default: ${config.scenario})`);

  return {
    port,
    httpUrl: `http://localhost:${port}`,
    wsUrl: `ws://localhost:${port}/ws`,
    close: () =>
      new Promise<void>((resolve) => {
        gateway.close(); // chiude le partite con game_over server_shutdown
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
