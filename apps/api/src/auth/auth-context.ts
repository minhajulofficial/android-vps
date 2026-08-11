import type { UserRow } from '../db/user-repo.js';

export type { UserSummary } from '../db/user-repo.js';

export interface UserRepo {
  findById(id: string): UserRow | undefined;
  findByUsername(username: string): UserRow | undefined;
  count(): number;
}

/** Augment FastifyInstance so route plugins can reach auth services. */
declare module 'fastify' {
  interface FastifyInstance {
    authServices?: {
      tokens: import('./jwt.js').TokenService;
      users: UserRepo;
    };
  }
}