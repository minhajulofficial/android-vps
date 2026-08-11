import type { FastifyServerOptions } from 'fastify';

/**
 * Structured logging via pino (Fastify's built-in logger).
 * All secrets/password/token fields are redacted before they can reach the
 * log sink, so accidental logging of credentials is impossible.
 */
export function loggerOptions(level: string): FastifyServerOptions['logger'] {
  return {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.token',
        'req.query.token',
        '*.password',
        '*.token',
        '*.secret'
      ],
      censor: '[REDACTED]'
    },
    serializers: {
      req(req) {
        return {
          method: req.method,
          url: sanitizeUrl(req.url),
          remoteAddress: req.socket?.remoteAddress,
          host: req.headers.host
        };
      }
    },
    base: { service: 'android-vps-api' }
  };
}

/** Never log credentials that may appear in query strings (e.g. WS tokens). */
export function sanitizeUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(/([?&])(token|password|secret)=[^&]*/gi, '$1$2=[REDACTED]');
}