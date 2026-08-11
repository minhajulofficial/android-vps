import type { AppConfig } from '../config.js';
import type { CommandRunner } from './command-runner.js';
import { DockerAdapter } from './adapters/docker.js';
import { QemuAdapter } from './adapters/qemu.js';
import { FakeAdapter } from './adapters/fake.js';
import { EmulatorAdapter, WaydroidAdapter } from './adapters/stubs.js';
import type { AdapterAvailability, RuntimeAdapter } from './types.js';

export interface DetectionResult {
  driver: RuntimeAdapter;
  /** Identifier used in stats/health payloads. */
  driverId: string;
  /** Human-readable reason for the current detection outcome. */
  reason: string;
}

/**
 * Chooses the Android runtime driver.
 *
 * `RUNTIME_DRIVER`:
 *  - "fake"  -> in-memory simulator (tests / local demo, never production)
 *  - "docker"-> force Docker/redroid (its `available()` still reports truthfully)
 *  - "qemu"  -> force QEMU/Android-x86
 *  - "auto"  -> prefer whatever actually works on this host
 *
 * IMPORTANT: availability is verified again at request time by the
 * InstanceManager — this selection only picks the adapter.
 */
export async function selectDriver(
  config: AppConfig,
  runner: CommandRunner
): Promise<DetectionResult> {
  const docker = new DockerAdapter(config, runner);
  const qemu = new QemuAdapter(config, runner);
  const fake = new FakeAdapter();

  switch (config.RUNTIME_DRIVER) {
    case 'fake':
      return { driver: fake, driverId: 'fake', reason: 'RUNTIME_DRIVER=fake — simulator (tests/demo only)' };
    case 'docker':
      return { driver: docker, driverId: 'docker', reason: 'RUNTIME_DRIVER=docker forced' };
    case 'qemu':
      return { driver: qemu, driverId: 'qemu', reason: 'RUNTIME_DRIVER=qemu forced' };
    case 'auto':
    default: {
      const dockerAvail = await docker.available();
      if (dockerAvail.available) {
        return { driver: docker, driverId: 'docker', reason: dockerAvail.reason };
      }
      const qemuAvail = await qemu.available();
      if (qemuAvail.available) {
        return { driver: qemu, driverId: 'qemu', reason: qemuAvail.reason };
      }
      // No working runtime found. Return docker so health reports it
      // truthfully as "unavailable" with the exact reason.
      return {
        driver: docker,
        driverId: 'docker',
        reason: `no usable runtime detected (docker: ${dockerAvail.reason}; qemu: ${qemuAvail.reason})`
      };
    }
  }
}

/** Currently unselected future adapters, kept for discovery in the dashboard. */
export function futureAdapters(): RuntimeAdapter[] {
  return [new WaydroidAdapter(), new EmulatorAdapter()];
}

export type { AdapterAvailability };