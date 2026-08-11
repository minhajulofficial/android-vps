# Architecture

> Status: **v0.1 MVP**. This document records the architecture decisions and the
> assumptions made during Phase 1. It is a living document — update it whenever a
> significant decision changes.

## 1. Goal

Run Android environments on a Linux VPS, make them remote/browser-accessible,
and manage multiple Android instances from a single control panel.

```
GitHub Repository
      │  (push to main)
      ▼
GitHub Actions  ───── CI (lint, typecheck, test, build) ──── deploy to VPS
      │
      ▼
Linux VPS
      │
      ├───────────────┬──────────────────────────────┐
      │               │                              │
      ▼               ▼                              ▼
  nginx (HTTPS)  Control Panel / Web Dashboard   Android Runtime
      │               │                         (RuntimeAdapter)
      ▼               │                              │
  API (Fastify)       │                ┌─────────────┼─────────────┐
      │               │                │             │             │
      ▼               │                ▼             ▼             ▼
  InstanceManager ────┘            redroid    QEMU/Android-x86   (future)
      │                        (Docker,      (KVM or TCG)
      │                          primary)
      ▼
  VNC / WebSocket proxy ──► noVNC ──► Browser
```

## 2. Key decisions (assumptions recorded)

| # | Decision | Assumption / rationale |
|---|----------|------------------------|
| 1 | New repo created at `android-vps/` inside the existing workspace | The existing `csvtree/` project is unrelated; it was left untouched. |
| 2 | Backend: Node.js + TypeScript + Fastify | Single-language stack, excellent typing, fast, first-class structured logging (pino), easy to test. |
| 3 | Frontend: static HTML/CSS/JS served by the API | No build step, zero frontend toolchain, easy to deploy and audit. The dashboard is intentionally dependency-free. |
| 4 | Database: SQLite via `better-sqlite3` behind a repository abstraction | Zero external services, single file, perfect for 1-VPS scale. The abstraction allows swapping to Postgres later. |
| 5 | MVP Android driver: **Docker/redroid (Option E)**, fallback **QEMU + Android-x86 (Option B/D)** | See §3. Capabilities are **detected at runtime**, never assumed. |
| 6 | Display: VNC + noVNC via an in-process WebSocket proxy | Works with both drivers; QEMU exposes VNC natively; redroid uses droidVNC-NG. |
| 7 | One API process manages all instances | Simplest correct model for the MVP; the InstanceManager + RuntimeAdapter boundary allows a future multi-node split. |
| 8 | Auth: JWT (Bearer) + bcrypt password hashing + in-memory rate limiting | Stateless, simple, adequate for MVP; upgrade path to refresh tokens/sessions documented in `docs/SECURITY.md`. |

## 3. Android runtime evaluation

The prompt requires an honest evaluation of five candidate technologies. The
final choice is **environment-dependent**, so the platform detects capabilities
at boot (`runtime/scripts/detect-runtime.sh`) and picks a compatible driver.

### 3.1 Comparison table

| Technology       | Performance | Isolation | GPU Requirement | VPS Compatibility | Difficulty |
| ---------------- | ----------- | --------- | --------------- | ----------------- | ---------- |
| Android Emulator (AOSP `emulator`) | Slow without KVM; requires lots of RAM | Good (single VM per emulator) | Optional (software rendering is very slow) | Poor — official emulator assumes desktop, nested virt rarely available | High |
| Android-x86 (bootable x86 Android) | Native speed with KVM; very slow under pure TCG emulation | Good (a VM per instance) | Optional | Fair — needs KVM or a lot of patience; image no longer officially released (Bliss OS fork) | Medium |
| Waydroid (LXC container) | Near-native (uses host kernel + binder) | Weak-ish (shared kernel, root can escape namespaces if misconfigured) | Optional (GPU passthrough helps) | Poor — requires `binder`/`binderfs` kernel modules + systemd on host; many VPS kernels cannot load them | High |
| KVM-based VM (QEMU/KVM) | Native speed with KVM; TCG fallback very slow | Strong (full VM) | Optional | Good on bare-metal/KVM VPSes, impossible on OpenVZ; nested virt on some clouds | Medium |
| Docker/containerized Android (**redroid**) | Near-native (containerized, no emulation) | Good (docker isolation + cgroup resource limits) | Optional (GPU via vendor modules) | **Best** — runs on any Linux with Docker + binder modules (`binder_linux` from redroid-modules) | Low-Medium |

### 3.2 Selection for MVP

**Primary driver: Docker + redroid (Option E).**

Why:

1. **Performance** — no CPU emulation layer. Android runs natively in a
   container, which matters enormously on a shared VPS.
2. **Multiple instances** — the MVP goal ("1 VPS → N instances") is trivial:
   one container per instance with per-container CPU/RAM/storage limits
   (`cgroups`), independent port mappings and filesystems.
3. **No GPU / no KVM required** — a standard Linux VPS with the redroid
   `binder_linux` kernel module (loaded at boot by `runtime/scripts/setup-runtime.sh`)
   is enough. This is the most achievable requirement profile for the widest
   range of VPS providers.
4. **Operations** — container lifecycle, logs and health are managed with the
   `docker` CLI through a strict, allow-listed command runner (no arbitrary
   shell execution, §7.4).

**Fallback driver: QEMU + Android-x86 (Options B + D).**

Some VPS providers cannot load the `binder` modules (restricted kernels,
OpenVZ, etc.). In that case the platform falls back to a QEMU VM running an
Android-x86/Bliss OS image:

- with `/dev/kvm` present → accelerated boot (usable),
- without KVM → TCG software emulation, clearly reported as
  **EXPERIMENTAL / SLOW** in the dashboard and logs.

**Not selected:**
- **AOSP emulator** — designed for workstations, poor headless/VPS story.
- **Waydroid** — best-in-class performance but the kernel-module + systemd
  requirements are the most fragile part of a VPS deployment; kept as a
  documented future adapter (`runtime/adapters/waydroid.stub.ts`, NOT IMPLEMENTED).

### 3.3 Honesty rule

The VPS capabilities are **never assumed**. `detect-runtime.sh` checks:

```
/dev/kvm?                 -> QEMU can be accelerated
/dev/binderfs + modules   -> redroid can run
docker reachable?         -> container engine available
```

If no driver is available, instance `start` returns
`RUNTIME_UNAVAILABLE` with a diagnostic message, and `/api/health` reports
`runtime: "unavailable"` — the platform never pretends an instance is running.

## 4. Repository layout

```
android-vps/
├── apps/
│   ├── api/          Fastify + TypeScript backend (single process)
│   └── web/          static dashboard (HTML/CSS/JS) + noVNC client
├── runtime/
│   ├── adapters/     driver implementations + capability detection
│   ├── instance-manager/ (docs + templates for lifecycle)
│   ├── templates/    config templates (redroid, qemu)
│   └── scripts/      setup/detect/install shell scripts (Linux)
├── infrastructure/
│   ├── docker/       docker-compose production overrides
│   ├── nginx/        reverse proxy config (HTTPS + WS)
│   ├── systemd/      systemd unit (non-Docker deploy)
│   └── firewall/     UFW rules
├── scripts/          dev/deploy helper scripts
├── docs/             all documentation (see §8)
├── .github/workflows/  ci.yml, deploy.yml
├── Dockerfile        multi-stage image (api + static web)
├── docker-compose.yml
└── .env.example
```

## 5. Backend architecture

```
HTTP/WS ──► Fastify
             ├─ security hooks  (rate limit, auth, validation)
             ├─ routes          (health, auth, instances, server stats)
             ├─ InstanceManager (lifecycle orchestration, resource checks, port allocation)
             │     └─ RuntimeAdapter  ◄─── selected by capability detection
             │           ├─ DockerAdapter  (redroid)      [MVP primary]
             │           ├─ QemuAdapter    (Android-x86)  [MVP fallback]
             │           ├─ FakeAdapter    (tests/demo only)
             │           ├─ WaydroidAdapter (NOT IMPLEMENTED)
             │           └─ EmulatorAdapter (NOT IMPLEMENTED)
             ├─ db layer (SQLite repositories: users, instances, instance_configs, instance_events, audit_logs)
             └─ vnc proxy  (WebSocket in → VNC TCP out, per instance)
```

### 5.1 Instance lifecycle states

```
stopped ──► starting ──► running ──► stopping ──► stopped
   │           │            │            │
   └───────────┴────error───┴────────────┘      (error is terminal for the
                                                 operation; instance can still
                                                 be started again)
destroyed (DELETE)
```

State transitions are persisted in `instances.status` and every transition is
recorded in `instance_events`.

### 5.2 Resource validation (on create/start)

Before creating or starting an instance the manager checks:

- total configured CPU (vcpu × instances) ≤ host CPUs
- total configured RAM ≤ host RAM − `MIN_FREE_MEMORY_MB`
- disk free ≥ `MIN_FREE_DISK_GB` + requested storage
- requested VNC/ADB ports are within range and not already reserved
- driver capability (KVM/binder/docker) — otherwise `RUNTIME_UNAVAILABLE`

Violations return `INSUFFICIENT_RESOURCES` (or a specific error code) with a
human-readable message. See `docs/API.md` for the exact payloads.

## 6. Remote display (browser access)

```
Android screen ──► VNC server (QEMU built-in | droidVNC-NG in redroid)
                        │
                        ▼
             VNC TCP port (per instance, 5900+)
                        │
                        ▼
        API WebSocket proxy (wss://host/novnc/ws?instance=<id>)
                        │
                        ▼
        noVNC client (served by API at /vnc/)
                        ▼
                   Browser
```

- Route: `https://domain.com/instance/<id>` opens the noVNC viewer for that
  instance (WebSocket auth via the same JWT, validated on the upgrade request).
- The proxy is **in-process**: one WebSocket connection per viewer, each
  proxying to the instance's local VNC port. No extra containers needed.
- noVNC client files are fetched by `scripts/fetch-novnc.sh` (pinned release)
  into `apps/web/vnc/` — the directory is gitignored and downloaded at
  build/deploy time to keep the repo small.

## 7. Security model

Full details in `docs/SECURITY.md`. Key design points:

1. **Process execution** — the only way the API runs commands is through
   `CommandRunner` (`src/runtime/command-runner.ts`):
   - `child_process.spawn(bin, args)` with **no shell**, so no shell injection
     is possible by construction;
   - binaries come from a fixed allowlist map (`docker`, `pgrep`, `kill`, …);
   - every argument is validated against a safe charset
     (`^[A-Za-z0-9._:/=,+-]+$`) and no user-supplied string is ever part of a
     binary name or a flag name;
   - timeouts on every invocation; stdout/stderr are captured and bounded;
   - instance names/ids are validated with `^[a-z0-9][a-z0-9-]{1,62}$`.
2. **Secrets** — `.env` never committed; only `.env.example` ships; JWT secret,
   admin password, VNC passwords, ADB keys live in VPS-hosted env or
   GitHub Secrets (deploy workflow). Nothing secret is ever logged (pino
   redaction configured in `src/logger.ts`).
3. **API** — every route validates input with zod, auth middleware protects
   all `/api/instances*` routes, admin role gates create/delete, rate limiting
   applies per-IP, and failed logins trigger temporary lockout.
4. **Network** — nginx terminates HTTPS, only ports 80/443 (and optional
   SSH/22) exposed; instance VNC/ADB ports are bound to `127.0.0.1` only and
   reachable exclusively through the authenticated proxy.

## 8. Documentation index

| File | Purpose |
|------|---------|
| `README.md` | Project overview, quickstart, links to everything else |
| `GUIDE.md` | Complete beginner-to-production guide (22 chapters) |
| `docs/ARCHITECTURE.md` | This file |
| `docs/VPS_SETUP.md` | Step-by-step VPS provisioning |
| `docs/ANDROID_SETUP.md` | Android runtime setup (redroid + fallback QEMU) |
| `docs/DEPLOYMENT.md` | Docker + systemd deployment, HTTPS, backup |
| `docs/SECURITY.md` | Threat model, hardening, audit checklist |
| `docs/API.md` | Full API reference (endpoints, envelopes, errors) |
| `docs/DEVELOPMENT.md` | Local development, testing, contribution |
| `docs/TROUBLESHOOTING.md` | Problem → cause → check → fix for every common failure |

## 9. Known limitations (MVP, honest)

- **KVM/binder availability varies per VPS** — if your provider blocks both,
  only the (slow) QEMU TCG fallback works. This is detected and reported, not
  hidden.
- **redroid GUI requires droidVNC-NG APK** — display and input work, but
  multi-touch gestures are limited; keyboard + mouse/touch basics supported.
- **Waydroid and AOSP-emulator adapters are NOT IMPLEMENTED** (stubs only).
- **Single-node** — all instances run on one VPS; horizontal scaling is a
  future design task.
- **GPU passthrough is not supported** — hardware-accelerated games will not
  run well. This is a hard physical limitation of most VPSes (no GPU attached).
- noVNC client assets are fetched at deploy time (see `scripts/fetch-novnc.sh`).
