import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../utils/errors.js';
import { bearerTokenFromHeader, type TokenService } from './jwt.js';
import type { UserRepo, UserSummary } from './auth-context.js';

export interface AuthContext {
  user: UserSummary;
}

/** Augment FastifyRequest with the authenticated user. */
declare module 'fastify' {
  interface FastifyRequest {
    user?: UserSummary;
    authError?: AppError;
  }
}

export interface AuthServices {
  tokens: TokenService;
  users: UserRepo;
}

export function currentUser(req: FastifyRequest): UserSummary {
  if (!req.user) throw new AppError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  return req.user;
}

export function requireAdmin(req: FastifyRequest): UserSummary {
  const user = currentUser(req);
  if (user.role !== 'admin') {
    throw new AppError({ code: 'FORBIDDEN', message: 'Administrator access required' });
  }
  return user;
}

/**
 * preHandler that authenticates the request using the `Authorization: Bearer`
 * header. Populates `request.user` or throws UNAUTHORIZED.
 */
export function authenticated(app: FastifyInstance): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const { tokens, users } = app.authServices as AuthServices;
  return async (req: FastifyRequest): Promise<void> => {
    const token = bearerTokenFromHeader(req.headers.authorization);
    if (!token) throw new AppError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    let payload;
    try {
      payload = tokens.verify(token);
    } catch {
      throw new AppError({ code: 'UNAUTHORIZED', message: 'Invalid or expired token' });
    }
    const user = users.findById(payload.sub);
    if (!user) throw new AppError({ code: 'UNAUTHORIZED', message: 'User no longer exists' });
    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      created_at: user.created_at,
      updated_at: user.updated_at
    };
  };
}