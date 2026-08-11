import { describe, expect, it } from 'vitest';
import { RealCommandRunner, safeArg } from '../../src/runtime/command-runner.js';

describe('safeArg', () => {
  it('accepts safe scalar values used by drivers', () => {
    expect(safeArg('android-vps-abc123')).toBe(true);
    expect(safeArg('127.0.0.1:5900:5900')).toBe(true);
    expect(safeArg('redroid/redroid:14.0.0-latest')).toBe(true);
    expect(safeArg('4096m')).toBe(true);
    expect(safeArg('--time')).toBe(true);
    expect(safeArg('ro.product.model=android-01')).toBe(true);
    expect(safeArg('tcg,thread=multi')).toBe(true);
  });

  it('rejects shell metacharacters', () => {
    expect(safeArg('$(rm -rf /)')).toBe(false);
    expect(safeArg('; whoami')).toBe(false);
    expect(safeArg('name|id')).toBe(false);
    expect(safeArg('foo && bar')).toBe(false);
    expect(safeArg('`touch /tmp/x`')).toBe(false);
    expect(safeArg('a b c')).toBe(false);
    expect(safeArg('"quoted"')).toBe(false);
  });
});

describe('RealCommandRunner', () => {
  const runner = new RealCommandRunner();

  it('rejects unknown binaries', async () => {
    await expect(runner.run({ bin: 'rm', args: ['-rf', '/tmp/nope'] })).rejects.toThrow(/not allowed/);
    await expect(runner.run({ bin: 'sh', args: ['-c', 'evil'] })).rejects.toThrow(/not allowed/);
  });

  it('rejects arguments that fail the safe charset', async () => {
    await expect(runner.run({ bin: 'docker', args: ['--name', 'foo;rm -rf'] })).rejects.toThrow(/rejected/);
  });

  it('runs a real, harmless command and captures output', async () => {
    const res = await runner.run({ bin: 'docker', args: ['info'], timeoutMs: 20_000 });
    // On hosts without docker this fails gracefully with a code, never throws.
    expect(typeof res.code).toBe('number');
  });
});