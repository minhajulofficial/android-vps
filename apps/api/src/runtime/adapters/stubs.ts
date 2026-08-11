import type { AdapterAvailability, InstanceSpec, RuntimeAdapter, RuntimeLogs, RuntimeStatus } from '../types.js';
import { AppError } from '../../utils/errors.js';

const NOT_IMPLEMENTED = 'NOT IMPLEMENTED';

function unavailable(reason: string): AdapterAvailability {
  return {
    available: false,
    reason,
    capabilities: { kvm: false, binder: false, dockerCli: false, qemuBinary: false, androidImage: false }
  };
}

function notImplemented(): never {
  throw new AppError({ code: 'DRIVER_ERROR', message: `Adapter is ${NOT_IMPLEMENTED}` });
}

/**
 * Waydroid (LXC container Android) — planned future driver.
 * Requires host binder kernel modules + systemd; frequently impossible on
 * managed VPS kernels. Tracked in docs as a future adapter.
 */
export class WaydroidAdapter implements RuntimeAdapter {
  readonly id = 'waydroid' as const;
  readonly label = `Waydroid (LXC container Android) — ${NOT_IMPLEMENTED}`;

  available(): Promise<AdapterAvailability> {
    return Promise.resolve(unavailable(`${NOT_IMPLEMENTED}: not selected for MVP (see docs/ARCHITECTURE.md)`));
  }

  probeAvailable(): Promise<boolean> {
    return Promise.resolve(false);
  }

  create(_spec: InstanceSpec): Promise<void> {
    notImplemented();
  }
  start(_spec: InstanceSpec): Promise<void> {
    notImplemented();
  }
  stop(_spec: InstanceSpec): Promise<void> {
    notImplemented();
  }
  destroy(_spec: InstanceSpec): Promise<void> {
    notImplemented();
  }
  status(_spec: InstanceSpec): Promise<RuntimeStatus> {
    notImplemented();
  }
  logs(_spec: InstanceSpec, _lines: number): Promise<RuntimeLogs> {
    notImplemented();
  }
}

/**
 * AOSP emulator driver — planned future adapter for workstation-grade hosts.
 */
export class EmulatorAdapter implements RuntimeAdapter {
  readonly id = 'emulator' as const;
  readonly label = `AOSP Android Emulator — ${NOT_IMPLEMENTED}`;

  available(): Promise<AdapterAvailability> {
    return Promise.resolve(unavailable(`${NOT_IMPLEMENTED}: desktop-oriented emulator not suitable for MVP VPS deployments`));
  }

  probeAvailable(): Promise<boolean> {
    return Promise.resolve(false);
  }

  create(_spec: InstanceSpec): Promise<void> {
    notImplemented();
  }
  start(_spec: InstanceSpec): Promise<void> {
    notImplemented();
  }
  stop(_spec: InstanceSpec): Promise<void> {
    notImplemented();
  }
  destroy(_spec: InstanceSpec): Promise<void> {
    notImplemented();
  }
  status(_spec: InstanceSpec): Promise<RuntimeStatus> {
    notImplemented();
  }
  logs(_spec: InstanceSpec, _lines: number): Promise<RuntimeLogs> {
    notImplemented();
  }
}