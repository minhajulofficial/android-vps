import { spawn } from 'node:child_process';

/**
 * Security boundary for ALL process execution in this platform.
 *
 * Rules:
 *   1. `spawn(bin, args)` with `shell: false` — no shell is involved,
 *      so shell-injection is impossible by construction.
 *   2. `bin` must be one of the allow-listed binaries below (or the
 *      operator-configured QEMU path).
 *   3. Every argument MUST pass `safeArg`. Arguments are always built from
 *      controlled code paths; user input only ever appears inside validated
 *      scalar values (ids, names, numbers), never as a binary or flag name.
 *   4. Every invocation has a hard timeout and bounded output capture.
 *
 * Usage from adapters: `runner.run({ bin: 'docker', args: [...] })`.
 */

export interface RunCommand {
  bin: string;
  args: string[];
  timeoutMs?: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export const ALLOWED_BINS = new Set<string>(['docker', 'pgrep', 'kill', 'truncate', 'tail']);

/** Argument charset: alphanumerics plus a conservative set of safe symbols. */
const SAFE_ARG = /^[A-Za-z0-9._:/=+,-]+$/;

export function safeArg(arg: string): boolean {
  return SAFE_ARG.test(arg);
}

export interface CommandRunner {
  run(command: RunCommand): Promise<RunResult>;
}

export const DEFAULT_TIMEOUT_MS = 60_000;

export class RealCommandRunner implements CommandRunner {
  constructor(private readonly extraBins: Record<string, string> = {}) {}

  async run(command: RunCommand): Promise<RunResult> {
    const { bin, args } = command;
    const timeoutMs = command.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const resolvedBin = this.extraBins[bin] ?? bin;
    const allowlisted = ALLOWED_BINS.has(bin) || Object.prototype.hasOwnProperty.call(this.extraBins, bin);
    if (!allowlisted) {
      throw new Error(`command runner: binary not allowed: ${bin}`);
    }
    for (const arg of args) {
      if (!safeArg(arg)) {
        throw new Error(`command runner: argument rejected by allowlist: ${JSON.stringify(arg)}`);
      }
    }

    return new Promise<RunResult>((resolve, _reject) => {
      const child = spawn(resolvedBin, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout?.on('data', (d: Buffer) => {
        stdout = (stdout + d.toString('utf8')).slice(-256_000);
      });
      child.stderr?.on('data', (d: Buffer) => {
        stderr = (stderr + d.toString('utf8')).slice(-256_000);
      });

      child.on('error', (err) => {
        // Binary missing on host (e.g. no docker installed) is an outcome,
        // not a crash — adapters inspect the exit code and report honestly.
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stdout: '', stderr: `failed to spawn ${bin}: ${err.message}`, code: 127 });
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, code: code ?? -1 });
      });
    });
  }
}