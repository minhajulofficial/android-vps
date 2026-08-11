import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync as fsMkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';

let app: FastifyInstance;
let webDir: string;
let dbFile: string;

async function request(method: string, url: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await app.inject({
    method: method as 'get' | 'post' | 'delete',
    url,
    payload: opts.body as any,
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {}
  });
  return { status: res.statusCode, json: () => res.json() as any, text: () => res.body };
}

let adminToken: string;

beforeAll(async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'avps-api-'));
  webDir = path.join(tmp, 'web');
  dbFile = path.join(tmp, 'test.db');
  fsMkdirSync(webDir, { recursive: true });
  const built = await buildApp({
    DB_PATH: dbFile,
    RUNTIME_DRIVER: 'fake',
    PUBLIC_URL: 'http://localhost:3000',
    MIN_FREE_MEMORY_MB: 0,
    MIN_FREE_DISK_GB: 0,
    RATE_LIMIT_MAX: 0,
    LOG_LEVEL: 'silent',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'admin-pass-123',
    DEFAULT_STORAGE_LIMIT_GB: 5,
    WEB_ROOT: webDir
  } as any);
  app = built.app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('public endpoints', () => {
  it('GET /api/health returns the healthy envelope', async () => {
    const res = await request('get', '/api/health');
    expect(res.status).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.data.status).toBe('healthy');
    expect(body.data.services.api).toBe('healthy');
    expect(body.data.services.database).toBe('healthy');
    expect(body.data.runtime.driver).toBe('fake');
  });

  it('unknown routes return the error envelope', async () => {
    const res = await request('get', '/api/does-not-exist');
    expect(res.status).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('authentication', () => {
  it('admin can log in and receives a token', async () => {
    const res = await request('post', '/api/auth/login', { body: { username: 'admin', password: 'admin-pass-123' } });
    expect(res.status).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.token).toBe('string');
    expect(body.data.user.role).toBe('admin');
    adminToken = body.data.token;
  });

  it('rejects bad credentials', async () => {
    const res = await request('post', '/api/auth/login', { body: { username: 'admin', password: 'wrong' } });
    expect(res.status).toBe(401);
    expect(res.json().error.code).toBe('AUTH_FAILED');
  });

  it('rejects malformed login payload', async () => {
    const res = await request('post', '/api/auth/login', { body: {} });
    expect(res.status).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /api/auth/me works with the token', async () => {
    const res = await request('get', '/api/auth/me', { token: adminToken });
    expect(res.status).toBe(200);
    expect(res.json().data.username).toBe('admin');
  });

  it('blocks protected routes without a token', async () => {
    const res = await request('get', '/api/instances');
    expect(res.status).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });
});

describe('instances over HTTP (fake driver)', () => {
  let instance: any;

  it('starts empty', async () => {
    const res = await request('get', '/api/instances', { token: adminToken });
    expect(res.json().data).toEqual([]);
  });

  it('creates an instance (admin only)', async () => {
    const res = await request('post', '/api/instances', {
      token: adminToken,
      body: { name: 'android-01', cpu_limit: 1, memory_limit_mb: 512, storage_limit_gb: 5 }
    });
    expect(res.status).toBe(201);
    instance = res.json().data;
    expect(instance.status).toBe('stopped');
  });

  it('rejects invalid instance definitions', async () => {
    const res = await request('post', '/api/instances', { token: adminToken, body: { name: 'BAD NAME!' } });
    expect(res.status).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('starts / statuses / stops / restarts the instance', async () => {
    const start = await request('post', `/api/instances/${instance.id}/start`, { token: adminToken });
    expect(start.status).toBe(200);
    expect(start.json().data.status).toBe('running');

    const status = await request('get', `/api/instances/${instance.id}/status`, { token: adminToken });
    expect(status.json().data.status).toBe('running');
    expect(status.json().data.live.kind).toBe('running');

    const logs = await request('get', `/api/instances/${instance.id}/logs`, { token: adminToken });
    expect(logs.json().data.lines).toContain('VNC display ready');

    const restart = await request('post', `/api/instances/${instance.id}/restart`, { token: adminToken });
    expect(restart.json().data.status).toBe('running');

    const stop = await request('post', `/api/instances/${instance.id}/stop`, { token: adminToken });
    expect(stop.json().data.status).toBe('stopped');
  });

  it('reports server stats', async () => {
    const res = await request('get', '/api/server/stats', { token: adminToken });
    expect(res.status).toBe(200);
    const data = res.json().data;
    expect(typeof data.cpus.count).toBe('number');
    expect(typeof data.memory.totalMb).toBe('number');
    expect(data.runtime).toBe('fake');
  });

  it('destroys the instance', async () => {
    const res = await request('delete', `/api/instances/${instance.id}`, { token: adminToken });
    expect(res.status).toBe(200);
    const res2 = await request('get', `/api/instances/${instance.id}`, { token: adminToken });
    expect(res2.status).toBe(404);
    expect(res2.json().error.code).toBe('INSTANCE_NOT_FOUND');
  });
});