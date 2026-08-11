# Android VPS Platform

Run Android environments on a Linux VPS, make them remote/browser-accessible, and manage
multiple Android instances from a single control panel.

- **Backend**: Node.js + TypeScript + Fastify
- **Frontend**: dependency-free static dashboard (HTML/CSS/JS) served by the API
- **Database**: SQLite behind a repository abstraction
- **Android runtime**: containerized **redroid** (Docker, primary) or **QEMU + Android-x86** (fallback), selected by automatic capability detection
- **Remote display**: VNC + in-process WebSocket proxy → noVNC in the browser

## Features

- Create, start, stop, restart, destroy — multiple Android instances per host
- Per-instance CPU / RAM / storage limits (cgroups on the Docker driver)
- Automatic runtime detection at boot (`/dev/kvm`, `binder` modules, Docker reachable) — never assumes capability
- Per-IP rate limiting, bcrypt password hashing, JWT auth, admin/user roles
- Browser-based console via noVNC (WebSocket auth uses the same JWT)
- Structured logging (pino), audit log, full API error envelope
- Strict command runner: no shell, allow-listed binaries, validated arguments

## Quickstart (local dev)

**Requirements**: Node >= 22.13, npm

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env        # then set JWT_SECRET and ADMIN_PASSWORD

# 3. Start the dev server (API + dashboard)
npm run dev
```

Open **http://localhost:3000** and log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD` from your
`.env`. The initial admin is seeded automatically on first boot if no users exist.

> On a normal desktop only the `fake` driver works out of the box. Real Android requires a
> Linux VPS with Docker + binder kernel modules (redroid) or KVM (QEMU). See **Runtime drivers**.

## Configuration

Copy `.env.example` to `.env` and adjust values. The important ones:

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | HMAC secret for tokens — generate with `openssl rand -hex 32` |
| `ADMIN_PASSWORD` | Password of the auto-seeded admin account |
| `DB_PATH` | SQLite file path |
| `RUNTIME_DRIVER` | `auto` (default) \| `docker` \| `qemu` \| `fake` |
| `VNC_PORT_START/END`, `ADB_PORT_START/END` | Per-instance port ranges |
| `DEFAULT_*` / `MAX_*` / `MIN_FREE_*` | Per-instance defaults, ceilings, and host headroom |

## Runtime drivers

| Driver | What it runs | When to use |
|--------|--------------|-------------|
| `auto` (default) | Best available driver detected at boot | Everywhere |
| `docker` | redroid Android container, near-native speed | Linux VPS with Docker + binder modules (recommended) |
| `qemu` | Android-x86 VM (KVM accelerated, else slow TCG) | VPS where binder modules can't be loaded |
| `fake` | In-memory simulator | Tests / demo only — never production |

## Using the API

Base URL: `http://localhost:3000`

```bash
# login
curl -s -X POST localhost:3000/api/auth/login \
  -H "content-type: application/json" \
  -d '{"username":"admin","password":"your-password"}'   # -> .data.token

TOKEN="<token from above>"
AUTH="Authorization: Bearer $TOKEN"

# instances
curl localhost:3000/api/instances -H "$AUTH"                                        # list
curl -X POST localhost:3000/api/instances -H "$AUTH" -H "content-type: application/json" \
  -d '{"name":"android-01","cpu_limit":2,"memory_limit_mb":4096,"storage_limit_gb":20}'  # create
curl -X POST localhost:3000/api/instances/<id>/start   -H "$AUTH"                   # start
curl localhost:3000/api/instances/<id>/status          -H "$AUTH"                   # status + live view
curl -X DELETE localhost:3000/api/instances/<id>       -H "$AUTH"                   # destroy (admin)
```

Instances are accessed from the browser console at `/instance/<id>` (VNC over an
authenticated WebSocket proxy).

## Project layout

```
android-vps/
├── apps/
│   ├── api/          Fastify + TypeScript backend (routes, auth, runtime, db)
│   └── web/          static dashboard + noVNC client
├── docs/             architecture and reference docs
├── .env.example      environment template
└── package.json      npm workspaces + scripts
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start API dev server (watch mode) |
| `npm run build` | Compile TypeScript |
| `npm start` | Run the compiled server |
| `npm test` | Unit + integration tests |
| `npm run lint` | ESLint (no warnings) |
| `npm run typecheck` | tsc type checking |
| `npm run seed:admin` | Create the admin user |
| `npm run db:migrate` | Run DB migrations |

## Documentation

See `docs/ARCHITECTURE.md` for the full design, runtime evaluation, security model, and
known limitations.

## License

[MIT](LICENSE)