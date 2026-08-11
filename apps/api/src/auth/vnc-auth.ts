import type { FastifyInstance } from 'fastify';
import { AppError } from '../utils/errors.js';
import { bearerTokenFromHeader } from './jwt.js';

export interface VncSession {
  instanceId: string;
  vncPort: number;
  user: { id: string; role: 'admin' | 'user' };
}

/**
 * Authenticate + authorize a noVNC WebSocket upgrade.
 * The JWT is passed as a query parameter (browser WebSockets cannot set
 * headers); the token and password are never logged.
 */
export async function authenticateVncSession(app: FastifyInstance, url: string): Promise<VncSession> {
  const parsed = new URL(url, 'http://x');
  const instanceId = parsed.searchParams.get('instance');
  const token = parsed.searchParams.get('token') ?? bearerTokenFromHeader(undefined);

  if (!instanceId || !token) {
    throw new AppError({ code: 'UNAUTHORIZED', message: 'Missing instance or token' });
  }

  const manager = app.manager!;
  let payload;
  try {
    payload = app.authServices!.tokens.verify(token);
  } catch {
    throw new AppError({ code: 'UNAUTHORIZED', message: 'Invalid or expired token' });
  }

  const user = app.authServices!.users.findById(payload.sub);
  if (!user) throw new AppError({ code: 'UNAUTHORIZED', message: 'User no longer exists' });

  const instance = manager.requireInstance(instanceId);
  const isAdmin = user.role === 'admin';
  const isOwner = instance.owner_id === null || instance.owner_id === user.id;
  if (!isAdmin && !isOwner) {
    throw new AppError({ code: 'FORBIDDEN', message: 'You do not have access to this instance' });
  }
  if (instance.status !== 'running') {
    throw new AppError({ code: 'CONFLICT', message: `Instance is not running (status: ${instance.status})` });
  }
  if (!instance.vnc_port) {
    throw new AppError({ code: 'CONFLICT', message: 'Instance has no VNC port assigned' });
  }

  return { instanceId: instance.id, vncPort: instance.vnc_port, user: { id: user.id, role: user.role } };
}