import type { SocketFactory, SocketHandlers } from '../ws/connection';

/** Socket controllato dal test: registra gli invii e permette di simulare apertura, frame e chiusura. */
export interface FakeSocket {
  readonly url: string;
  readonly sent: string[];
  closedWith: number | null;
  open(): void;
  receive(frame: string | object): void;
  /** Chiusura lato server (o di rete). */
  drop(code?: number): void;
}

export function fakeSockets() {
  const sockets: FakeSocket[] = [];
  const factory: SocketFactory = (url: string, handlers: SocketHandlers) => {
    const socket: FakeSocket = {
      url,
      sent: [],
      closedWith: null,
      open: () => handlers.onOpen(),
      receive: (frame) => handlers.onMessage(typeof frame === 'string' ? frame : JSON.stringify(frame)),
      drop: (code = 1006) => handlers.onClose(code),
    };
    sockets.push(socket);
    return {
      send: (data) => void socket.sent.push(data),
      close: (code = 1000) => {
        socket.closedWith = code;
      },
    };
  };
  return {
    sockets,
    factory,
    last(): FakeSocket {
      const socket = sockets.at(-1);
      if (socket === undefined) throw new Error('nessun socket aperto');
      return socket;
    },
  };
}
