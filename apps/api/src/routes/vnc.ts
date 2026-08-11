import net from 'node:net';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticateVncSession } from '../auth/vnc-auth.js';
import { AppError } from '../utils/errors.js';

interface WsSocket {
  on(event: string, cb: (...args: never[]) => void): void;
  send(data: Buffer, opts?: { binary?: boolean }, cb?: () => void): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

function replyError(socket: WsSocket, code: number, message: string): void {
  try {
    socket.close(code, message);
  } catch {
    socket.terminate();
  }
}

/**
 * Browser (noVNC) WebSocket â†’ instance VNC TCP proxy.
 *
 * Route: wss://host/novnc/ws?instance=<id>&token=<jwt>
 * The token is validated on upgrade; the connection is only ever bridged to
 * the instance's loopback-bound VNC port. VNC ports are never exposed
 * directly to the internet.
 */
export function registerVncRoutes(app: FastifyInstance): void {
  /* GET /instance/:id → viewer page (served by static files at /vnc) */
  app.get('/instance/:id', async (_req, reply) => {
    return reply.sendFile('console.html');
  });

  app.get('/novnc/ws', { websocket: true }, async (socket: { socket: WsSocket }, request: FastifyRequest) => {
    const ws = socket.socket;
    let session: { instanceId: string; vncPort: number } | null = null;
    try {
      session = await authenticateVncSession(app, request.url);
    } catch (err) {
      const message = err instanceof AppError ? err.message : 'authentication failed';
      app.log.warn({ event: 'vnc.auth_failed', url: request.url.split('?')[0] }, message);
      replyError(ws, 4001, message);
      return;
    }

    const { instanceId, vncPort } = session;
    const tcp = net.connect({ host: '127.0.0.1', port: vncPort });
    let tcpReady = false;
    let wsClosed = false;
    let tcpClosed = false;

    const teardown = (): void => {
      if (wsClosed && tcpClosed) return;
      if (!tcpClosed) {
        tcpClosed = true;
        tcp.destroy();
      }
      if (!wsClosed) {
        wsClosed = true;
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
      }
    };

    tcp.on('connect', () => {
      tcpReady = true;
      app.log.info({ event: 'vnc.connected', instance: instanceId, port: vncPort }, 'VNC tunnel established');
    });

    tcp.on('data', (data: Buffer) => {
      if (wsClosed) return;
      try {
        ws.send(data, { binary: true });
      } catch {
        teardown();
      }
    });

    tcp.on('error', () => teardown());

    ws.on('message', (data: Buffer | ArrayBuffer | string) => {
      if (tcpClosed || !tcpReady) return;
      if (!tcp.writable) return;
      const buf = typeof data === 'string' || Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data as ArrayBuffer);
      tcp.write(buf);
    });

    ws.on('close', () => teardown());
    ws.on('error', () => teardown());
    tcp.on('close', () => teardown());
  });
}