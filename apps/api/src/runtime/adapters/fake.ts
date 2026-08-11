import type { AdapterAvailability, InstanceSpec, RuntimeAdapter, RuntimeLogs, RuntimeStatus } from '../types.js';

interface FakeState {
  status: 'starting' | 'running' | 'stopping' | 'stopped';
  pid: number;
  startedAt: number | null;
}

/**
 * In-memory simulator used ONLY by tests and local demo mode
 * (RUNTIME_DRIVER=fake). It never spawns processes and works on any OS.
 * It is deliberately excluded from production capability reports.
 */
export class FakeAdapter implements RuntimeAdapter {
  readonly id = 'fake' as const;
  readonly label = 'FakeAdapter (in-memory simulator — NOT for production)';

  private readonly states = new Map<string, FakeState>();
  private nextPid = 10_000;

  async available(): Promise<AdapterAvailability> {
    return {
      available: true,
      reason: 'fake driver selected (tests/demo only)',
      capabilities: { kvm: false, binder: false, dockerCli: false, qemuBinary: false, androidImage: false }
    };
  }

  probeAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  async create(spec: InstanceSpec): Promise<void> {
    this.states.set(spec.id, { status: 'stopped', pid: 0, startedAt: null });
  }

  async start(spec: InstanceSpec): Promise<void> {
    const state = this.states.get(spec.id) ?? { status: 'stopped', pid: 0, startedAt: null };
    state.status = 'starting';
    this.states.set(spec.id, state);
    await this.wait(400);
    state.status = 'running';
    state.pid = this.nextPid++;
    state.startedAt = Date.now();
  }

  async stop(spec: InstanceSpec): Promise<void> {
    const state = this.states.get(spec.id);
    if (!state || state.status === 'stopped') return;
    state.status = 'stopping';
    await this.wait(300);
    state.status = 'stopped';
    state.startedAt = null;
  }

  async destroy(spec: InstanceSpec): Promise<void> {
    this.states.delete(spec.id);
  }

  async status(spec: InstanceSpec): Promise<RuntimeStatus> {
    const state = this.states.get(spec.id);
    if (!state || state.status === 'stopped') return { kind: 'stopped' };
    return {
      kind: 'running',
      pid: state.pid,
      uptimeSeconds: state.startedAt ? Math.round((Date.now() - state.startedAt) / 1000) : null,
      vncPort: spec.vncPort
    };
  }

  async logs(spec: InstanceSpec, lines: number): Promise<RuntimeLogs> {
    const boot = [
      `[   0.000000] fake: linux bootstrapping android-vps instance ${spec.id} (driver=fake)`,
      `[   0.410203] fake: mounting /dev/binderfs`,
      `[   1.102923] fake: init: starting zygote`,
      `[   2.221912] fake: boot completed in 2.2s`,
      `[   3.000001] fake: VNC display ready on port ${spec.vncPort}`
    ];
    return { text: boot.slice(-lines).join('\n') + '\n' };
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}