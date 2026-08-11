import os from 'node:os';
import fs from 'node:fs';
import type { AppConfig } from '../config.js';

export interface MemoryStat {
  totalMb: number;
  freeMb: number;
  usedMb: number;
  usedPercent: number;
}

export interface DiskStat {
  totalGb: number;
  freeGb: number;
  usedGb: number;
  usedPercent: number;
}

export interface ServerStats {
  hostname: string;
  platform: string;
  arch: string;
  uptimeSeconds: number;
  loadAvg: number[];
  cpus: { count: number; model: string; usagePercent: number };
  memory: MemoryStat;
  disk: DiskStat;
  instances: { total: number; running: number; stopped: number };
  runtime: string;
}

let lastCpuSample: { idle: number; total: number } | null = null;

function cpuUsagePercent(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    for (const t of Object.values(c.times)) total += t;
    idle += c.times.idle;
  }
  const now = { idle, total };
  if (!lastCpuSample) {
    lastCpuSample = now;
    return 0;
  }
  const idleDelta = now.idle - lastCpuSample.idle;
  const totalDelta = now.total - lastCpuSample.total;
  lastCpuSample = now;
  if (totalDelta <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((totalDelta - idleDelta) / totalDelta) * 100)));
}

async function readProcMeminfo(): Promise<MemoryStat | null> {
  try {
    const text = await fs.promises.readFile('/proc/meminfo', 'utf8');
    const lines = new Map(
      text.split('\n').map((l) => {
        const m = /^(\w+):\s+(\d+)\s*kB/.exec(l);
        return m ? [m[1], parseInt(m[2], 10)] : null;
      }).filter(Boolean) as [string, number][]
    );
    const total = (lines.get('MemTotal') ?? 0) / 1024;
    const available = (lines.get('MemAvailable') ?? lines.get('MemFree') ?? 0) / 1024;
    if (!total) return null;
    return { totalMb: total, freeMb: available, usedMb: total - available, usedPercent: Math.round(((total - available) / total) * 100) };
  } catch {
    return null;
  }
}

function memoryFromOs(): MemoryStat {
  const totalMb = Math.round(os.totalmem() / 1024 / 1024);
  const freeMb = Math.round(os.freemem() / 1024 / 1024);
  const usedMb = totalMb - freeMb;
  return { totalMb, freeMb, usedMb, usedPercent: totalMb ? Math.round((usedMb / totalMb) * 100) : 0 };
}

export async function collectDiskStat(target: string): Promise<DiskStat> {
  const zeros: DiskStat = { totalGb: 0, freeGb: 0, usedGb: 0, usedPercent: 0 };
  try {
    const s = await fs.promises.statfs(target);
    const total = s.bsize * s.blocks;
    const free = s.bsize * s.bavail;
    const used = total - free;
    return {
      totalGb: Math.round(total / 1024 ** 3),
      freeGb: Math.round(free / 1024 ** 3),
      usedGb: Math.round(used / 1024 ** 3),
      usedPercent: total ? Math.round((used / total) * 100) : 0
    };
  } catch {
    return zeros;
  }
}

export async function collectServerStats(
  config: AppConfig,
  instanceCounts: { total: number; running: number; stopped: number },
  runtimeDriver: string
): Promise<ServerStats> {
  const mem = (await readProcMeminfo()) ?? memoryFromOs();
  const disk = await collectDiskStat(config.DB_PATH.startsWith(':memory:') ? '.' : config.DB_PATH);
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptimeSeconds: Math.round(os.uptime()),
    loadAvg: os.loadavg().map((x) => Math.round(x * 100) / 100),
    cpus: { count: cpus.length, model: cpus[0]?.model ?? 'unknown', usagePercent: cpuUsagePercent() },
    memory: mem,
    disk,
    instances: instanceCounts,
    runtime: runtimeDriver
  };
}