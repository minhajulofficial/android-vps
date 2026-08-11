import os from 'node:os';
import fs from 'node:fs';
import type { AppConfig } from '../../config.js';
import type { CommandRunner } from '../command-runner.js';
import type { AdapterAvailability, InstanceSpec, RuntimeAdapter, RuntimeLogs, RuntimeStatus } from '../types.js';

const CONTAINER_PREFIX = 'android-vps-';

function containerName(id: string): string {
  return `${CONTAINER_PREFIX}${id}`;
}

/**
 * Docker/redroid driver — the MVP primary runtime.
 * Each instance = one Android 8+/11/13/14 container sharing the host kernel.
 * Requires: a Linux host, Docker, and the redroid `binder`/`binderfs` module.
 * See runtime/scripts/setup-runtime.sh for provisioning.
 */
export class DockerAdapter implements RuntimeAdapter {
  readonly id = 'docker' as const;
  readonly label = 'Docker/redroid (containerized Android)';

  constructor(
    private readonly config: AppConfig,
    private readonly runner: CommandRunner
  ) {}

  async available(): Promise<AdapterAvailability> {
    const caps = {
      kvm: false,
      binder: false,
      dockerCli: false,
      qemuBinary: false,
      androidImage: false
    };
    if (os.platform() !== 'linux') {
      return {
        available: false,
        reason: 'redroid requires a Linux host (binder kernel module). Detected: ' + os.platform(),
        capabilities: caps
      };
    }
    const binderOk =
      (await this.pathExists('/dev/binder')) || (await this.pathExists('/dev/binderfs'));
    caps.binder = binderOk;

    try {
      const res = await this.runner.run({ bin: 'docker', args: ['info'], timeoutMs: 15_000 });
      caps.dockerCli = res.code === 0;
    } catch {
      caps.dockerCli = false;
    }

    if (!caps.dockerCli) {
      return { available: false, reason: 'docker CLI or daemon is not reachable', capabilities: caps };
    }
    if (!caps.binder) {
      return {
        available: false,
        reason: 'binder/binderfs kernel module not found — run runtime/scripts/setup-runtime.sh',
        capabilities: caps
      };
    }
    return { available: true, reason: 'redroid ready', capabilities: caps };
  }

  probeAvailable(): Promise<boolean> {
    return this.available().then((a) => a.available);
  }

  async create(_spec: InstanceSpec): Promise<void> {
    await this.ensureImage();
  }

  async start(spec: InstanceSpec): Promise<void> {
    await this.ensureImage();
    await this.removeContainerIfExists(spec.id);
    const props = this.buildProps(spec);
    const args: string[] = [
      'run',
      '-d',
      '--name',
      containerName(spec.id),
      '--privileged',
      '-p',
      `127.0.0.1:${spec.adbPort}:5555`,
      '-p',
      `127.0.0.1:${spec.vncPort}:5900`,
      '--memory',
      `${spec.memoryMb}m`,
      '--cpus',
      String(spec.cpu),
      '-v',
      '/dev/binderfs:/dev/binderfs',
      '--memory-swappiness',
      '0',
      this.config.REDROID_IMAGE,
      ...props
    ];
    const res = await this.runner.run({ bin: 'docker', args, timeoutMs: 120_000 });
    if (res.code !== 0) {
      throw new Error(`docker run failed: ${res.stderr.trim() || res.stdout.trim()}`);
    }
  }

  async stop(spec: InstanceSpec): Promise<void> {
    const res = await this.runner.run({
      bin: 'docker',
      args: ['stop', '--time', '20', containerName(spec.id)],
      timeoutMs: 60_000
    });
    if (res.code !== 0) {
      const missing = res.stderr.includes('No such container');
      if (!missing) throw new Error(`docker stop failed: ${res.stderr.trim()}`);
    }
  }

  async destroy(spec: InstanceSpec): Promise<void> {
    await this.runner.run({
      bin: 'docker',
      args: ['rm', '-f', containerName(spec.id)],
      timeoutMs: 30_000
    });
  }

  async status(spec: InstanceSpec): Promise<RuntimeStatus> {
    const exists = await this.runner.run({
      bin: 'docker',
      args: ['ps', '-a', '-q', '--filter', `name=${containerName(spec.id)}`],
      timeoutMs: 20_000
    });
    if (exists.code !== 0 || !exists.stdout.trim()) return { kind: 'stopped' };

    const inspect = await this.runner.run({
      bin: 'docker',
      args: ['inspect', containerName(spec.id)],
      timeoutMs: 20_000
    });
    if (inspect.code !== 0) return { kind: 'stopped' };

    try {
      const data = JSON.parse(inspect.stdout) as Array<{
        State?: { Status?: string; Running?: boolean; Pid?: number; StartedAt?: string; Error?: string };
      }>;
      const state = data[0]?.State;
      if (!state) return { kind: 'stopped' };
      if (state.Running) {
        let uptime = null;
        if (state.StartedAt) {
          uptime = Math.max(0, Math.round((Date.now() - Date.parse(state.StartedAt)) / 1000));
        }
        return { kind: 'running', pid: state.Pid ?? null, uptimeSeconds: uptime, vncPort: spec.vncPort };
      }
      if (state.Status === 'exited' && state.Error) {
        return { kind: 'error', message: state.Error };
      }
      return { kind: 'stopped' };
    } catch {
      return { kind: 'stopped' };
    }
  }

  async logs(spec: InstanceSpec, lines: number): Promise<RuntimeLogs> {
    const res = await this.runner.run({
      bin: 'docker',
      args: ['logs', '--tail', String(lines), containerName(spec.id)],
      timeoutMs: 20_000
    });
    const text = [res.stdout, res.stderr].filter(Boolean).join('\n');
    return { text: text ? text + '\n' : '(no logs — container was never started or was removed)\n' };
  }

  private buildProps(spec: InstanceSpec): string[] {
    const model = `ro.product.model=${spec.name}`;
    const name = `ro.product.name=${spec.name}`;
    const device = `ro.product.device=${spec.name}`;
    const brand = `ro.product.brand=android-vps`;
    const manufacturer = `ro.product.manufacturer=Android-VPS`;
    const secure = `ro.adb.secure=0`;
    return [model, name, device, brand, manufacturer, secure];
  }

  private async ensureImage(): Promise<void> {
    const res = await this.runner.run({ bin: 'docker', args: ['pull', this.config.REDROID_IMAGE], timeoutMs: 300_000 });
    if (res.code !== 0 && !res.stderr.includes('Image is up to date')) {
      throw new Error(`could not pull image ${this.config.REDROID_IMAGE}: ${res.stderr.trim()}`);
    }
  }

  private async removeContainerIfExists(id: string): Promise<void> {
    await this.runner.run({
      bin: 'docker',
      args: ['rm', '-f', containerName(id)],
      timeoutMs: 30_000
    });
  }

  private async pathExists(p: string): Promise<boolean> {
    try {
      await fs.promises.access(p);
      return true;
    } catch {
      return false;
    }
  }
}