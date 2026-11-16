# Weavi Space (小围空间)

[中文](./README.md) · License: [AGPL-3.0](./LICENSE)

A project collaboration workspace for Chinese-speaking teams that weaves people, work and AI together. The UI is in Simplified Chinese.

- **Work**: workbench, public and per-project requirement pools, project boards (drag and drop), releases (scheduled and hotfix), bugs, progress overview.
- **Docs and products**: Confluence-style document spaces with versions, product intro, feature tree, environments and architecture diagrams.
- **Organization**: multiple enterprises with strict data isolation, departments, roles and a permission matrix, invite-only accounts.
- **Sign-in**: password, email / SMS codes, Feishu (Lark), WeCom and DingTalk QR login, per-enterprise login links.
- **AI**: chat scoped to a project, all your projects or a local folder; personal skills (requirement analysis, PRD, prototype, test cases, test report, your own SKILL.md); image generation; an MCP server so other agents can work with your data under your permissions. Bring your own model keys (Anthropic, OpenAI, Gemini, DeepSeek, Qwen, Zhipu, Kimi, Doubao or any OpenAI-compatible endpoint), with per-enterprise token quotas.
- **Look**: two styles ("Weavi" warm and "Classic" blue), each with light and dark mode.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 3 · Prisma 5 + PostgreSQL 16 · server-side sessions · pg-boss for background jobs.

## Quick start (local)

Requires Node.js 22.5+ and PostgreSQL 16.

```bash
cp .env.example .env          # set DATABASE_URL, AUTH_SECRET (openssl rand -base64 48), COOKIE_SECURE=false
createdb pm_collab_local
npm ci
npx prisma migrate deploy
npm run db:seed               # demo data; wipes the database it points to (only allowed for local/demo/test names)
npm run dev                   # http://localhost:3100
```

Demo accounts are printed by the seed script and are for local use only.

## Deploy

- Plain install (Node.js + PostgreSQL on one server): `bash deploy/setup.sh`, see [`deploy/README.md`](./deploy/README.md).
- Docker Compose (web + PostgreSQL + MinIO): see [`docker/README.md`](./docker/README.md).
- Health check: `GET /api/healthz`. Backups: `deploy/backup.sh` / `deploy/restore.sh`.

Production needs `AUTH_SECRET` and `ENCRYPTION_KEY` (32+ characters each, never change `ENCRYPTION_KEY` once set), `APP_URL`, and `TRUST_PROXY=1` behind a reverse proxy. All options are documented in [`.env.example`](./.env.example).

## Development

```bash
npx tsc --noEmit -p .
npm run lint
npm run test:unit
npm run build
npx tsx scripts/security.check.ts
```

Schema changes go through `prisma/migrations` only (`npx prisma migrate dev --name <name>`). See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Contact

Questions about deployment, rolling it out inside your company, or feature ideas? Scan the QR code to add the author on WeChat (mention "Weavi Space"), or open an Issue / PR.

<img src="./site/assets/wechat-qr.jpg" alt="Author's WeChat QR code" width="220">

## License

[GNU AGPL-3.0](./LICENSE). You may use, modify and redistribute it. If you run a modified version as a network service, you must offer its complete source code to the users of that service (section 13). The in-app Help panel links to the source; set `NEXT_PUBLIC_SOURCE_CODE_URL` to your own repository when you deploy a modified version.

## Security

Please report vulnerabilities privately as described in [`docs/SECURITY.md`](./docs/SECURITY.md). Never paste keys, tokens or real customer data into public issues.
