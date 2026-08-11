import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticated, currentUser } from '../auth/middleware.js';
import { loginSchema } from '../security/validation.js';
import { verifyPassword } from '../auth/password.js';
import { publicUser } from '../db/user-repo.js';
import { AppError } from '../utils/errors.js';
import { ok } from '../utils/api-response.js';
import { clientKey } from '../security/rate-limit.js';
import { bearerTokenFromHeader } from '../auth/jwt.js';

function clientIp(req: FastifyRequest): string {
  return req.ip ?? 'unknown';
}

export function registerAuthRoutes(app: FastifyInstance): void {
  const services = app.authServices!;
  const limiter = app.limiter!;
  const login = app.loginConfig!;

  /* POST /api/auth/login */
  app.post('/api/auth/login', async (req, reply) => {
    const ipKey = clientKey(clientIp(req), 'login');
    if (!limiter.consume(ipKey)) {
      throw new AppError({ code: 'RATE_LIMITED', message: 'Too many login attempts from this address' });
    }

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'Invalid login payload',
        details: parsed.error.flatten().fieldErrors
      });
    }
    const { username, password } = parsed.data;

    const userKey = clientKey(username.toLowerCase(), 'user');
    if (!limiter.consume(userKey)) {
      throw new AppError({
        code: 'RATE_LIMITED',
        message: `Account temporarily locked after repeated failed attempts (${login.lockoutSeconds}s)`
      });
    }

    const user = services.users.findByUsername(username);
    const valid = user ? verifyPassword(password, user.password_hash) : false;
    if (!user || !valid) {
      app.log.warn({ event: 'auth.login_failed', username }, 'login failed');
      if (user) {
        const locked = limiter.noteFailure(userKey, login.maxAttempts, login.lockoutSeconds);
        if (locked) {
          app.log.warn({ event: 'auth.locked', username }, 'account temporarily locked');
        }
      }
      throw new AppError({ code: 'AUTH_FAILED', message: 'Invalid username or password' });
    }

    limiter.reset(userKey);
    limiter.reset(ipKey);
    const token = services.tokens.sign({ id: user.id, username: user.username, role: user.role });
    app.audit?.({ user_id: user.id, action: 'auth.login', target: 'login', meta: `username=${user.username}` });
    return reply.send(ok({ token, user: publicUser(user) }));
  });

  /* POST /api/auth/logout (stateless JWT: client discards the token) */
  app.post('/api/auth/logout', async (_req, reply) => {
    app.audit?.({ user_id: null, action: 'auth.logout', target: 'logout', meta: '' });
    return reply.send(ok(null));
  });

  /* GET /api/auth/me */
  app.get('/api/auth/me', { preHandler: [authenticated(app)] }, async (req, reply) => {
    const user = currentUser(req);
    return reply.send(ok(user));
  });

  /** Validate a token (used by the dashboard to check/refresh the session). */
  app.post('/api/auth/verify', async (req, reply) => {
    const parsed = (req.body ?? {}) as { token?: string };
    const token = parsed.token ?? bearerTokenFromHeader(req.headers.authorization);
    if (!token) throw new AppError({ code: 'UNAUTHORIZED', message: 'No token provided' });
    try {
      const payload = services.tokens.verify(token);
      const user = services.users.findById(payload.sub);
      if (!user) throw new Error('missing user');
      return reply.send(ok({ valid: true, user: publicUser(user) }));
    } catch {
      return reply.send(ok({ valid: false, user: null }));
    }
  });
}