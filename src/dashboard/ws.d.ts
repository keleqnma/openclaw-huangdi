declare module 'ws' {
  import * as http from 'http';

  export class WebSocket {
    static OPEN: number;
    readyState: number;
    send(data: any): void;
    close(): void;
    on(event: 'message', cb: (data: any) => void): void;
    on(event: 'close', cb: () => void): void;
    on(event: 'error', cb: (err: Error) => void): void;
    on(event: string, cb: (...args: any[]) => void): void;
  }

  export interface WebSocketServerOptions {
    noServer?: boolean;
    pingInterval?: number;
    port?: number;
  }

  export class WebSocketServer {
    constructor(options: WebSocketServerOptions);
    handleUpgrade(
      request: http.IncomingMessage,
      socket: import('net').Socket,
      head: Buffer,
      callback: (ws: WebSocket) => void
    ): void;
    close(cb?: () => void): void;
  }
}
