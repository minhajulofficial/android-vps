export type InstanceStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export type AdapterId = 'docker' | 'qemu' | 'fake' | 'waydroid' | 'emulator';

/**
 * Everything a driver needs to know about one instance. This is purely
 * driver-agnostic — no driver logic leaks into the API layer.
 */
export interface InstanceSpec {
  id: string;
  name: string;
  androidVersion: string;
  cpu: number;
  memoryMb: number;
  storageGb: number;
  vncPort: number;
  adbPort: number | null;
  /** Driver-specific validated settings, e.g. { qemu_accel: 'kvm' | 'tcg' }. */
  configs: Record<string, string>;
}

export interface AdapterCapabilities {
  kvm: boolean;
  binder: boolean;
  dockerCli: boolean;
  qemuBinary: boolean;
  androidImage: boolean;
}

export interface AdapterAvailability {
  available: boolean;
  reason: string;
  capabilities: AdapterCapabilities;
}

export type RuntimeStatus =
  | { kind: 'stopped' }
  | { kind: 'running'; pid: number | null; uptimeSeconds: number | null; vncPort: number }
  | { kind: 'error'; message: string };

export interface RuntimeLogs {
  text: string;
}

/**
 * Backend-agnostic contract implemented by every Android runtime driver.
 * Swapping runtimes never requires touching the API/dashboard layer.
 */
export interface RuntimeAdapter {
  readonly id: AdapterId;
  readonly label: string;

  /** Whether this driver can work on the CURRENT host (honest capability check). */
  available(): Promise<AdapterAvailability>;

  /** Allocate resources / create the backing store for the instance. */
  create(spec: InstanceSpec): Promise<void>;

  /** Boot the Android instance. */
  start(spec: InstanceSpec): Promise<void>;

  /** Gracefully shut the instance down. */
  stop(spec: InstanceSpec): Promise<void>;

  /** Tear down and free resources. */
  destroy(spec: InstanceSpec): Promise<void>;

  /** Live status of a specific instance. */
  status(spec: InstanceSpec): Promise<RuntimeStatus>;

  /** Probe the host to determine whether there is a runtime available at all. */
  probeAvailable(): Promise<boolean>;

  /** Recent instance logs (tail). */
  logs(spec: InstanceSpec, lines: number): Promise<RuntimeLogs>;
}