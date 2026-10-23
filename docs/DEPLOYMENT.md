# Deployment guide

The live demo runs on Vercel (Option C). Option A runs the same `docker-compose.yml`
as local development, with HTTPS added in front.

## Option A: one VM (recommended)

Any small Linux VM works (Oracle Cloud Always Free, a $5 VPS, etc.). 2 GB RAM is
comfortable for the whole stack.

1. **Install Docker** on the VM and clone the repo.
2. **Create `.env`** from `.env.example` and set at least:

   | Variable | Value |
   |---|---|
   | `JWT_SECRET` | a long random string: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `ADMIN_EMAILS` | the email you'll sign up with |
   | `LLM_PROVIDER` / `ANTHROPIC_API_KEY` / `CHAT_MODEL` | `anthropic` + your key for real answers (`claude-haiku-5-5` is cheapest), or leave `mock` |
   | `EMBEDDING_PROVIDER` / `VOYAGE_API_KEY` | `voyage` + your key (first 200M tokens are free), or leave `mock` |

3. **Put HTTPS in front.** In production the session cookie is `Secure`, so **login only
   works over HTTPS** (browsers make an exception for `localhost` only). The simplest
   option is [Caddy](https://caddyserver.com), which gets certificates automatically. Add
   to `docker-compose.yml`:

   ```yaml
   caddy:
     image: caddy:2
     ports: ["80:80", "443:443"]
     command: caddy reverse-proxy --from docspilot.example.com --to web:3000
     volumes: [caddy_data:/data]
     depends_on: [web]
   # and under volumes:  caddy_data:
   ```

   No domain? `docspilot.<your-ip-with-dashes>.sslip.io` resolves to your IP and works
   with Caddy's certificates.

4. **Don't publish internal ports.** In production, remove the `ports:` lines for
   `postgres`, `redis` and `api`; only Caddy should be reachable. (`/metrics` and
   `/health` stay reachable inside the Docker network for monitoring.)
5. **Start:** `docker compose up -d --build`. Migrations run automatically before the API
   and worker start.
6. **Back up** the `pgdata` volume (`pg_dump` on a schedule). Uploaded files in the
   `uploads` volume only matter until a document is ingested.

## Option B: free managed services

Vercel (web) + Render (API) + Neon (Postgres with pgvector) + Upstash (Redis). Things to
know before choosing this:

- Render's free web services sleep when idle (the first request takes ~1 minute), and
  background workers aren't free: you'd run the worker inside the API process.
- The API's local upload directory isn't persistent there; files must be ingested before
  a restart, or swap `services/storage.ts` for S3-compatible storage.
- BullMQ polls Redis continuously, which can use up a free command quota.
- Set `API_URL` for the web app at **build** time too (it's baked into the `/api` rewrite).

## Option C: everything on Vercel (the live demo)

https://docspilot.vercel.app runs as one Vercel project, configured in
[`vercel.json`](../vercel.json):

- **Two [Vercel Services](https://vercel.com/docs/services) on one domain:** Next.js
  (`apps/web`) at `/`, and the Express API (`apps/api/src/vercel.ts`) at `/api/*`.
  Cookies stay first-party, and Vercel's proxy passes the real client IP for rate
  limits. Server components reach the API over a private service binding (`API_URL`);
  `/health` and `/metrics` aren't public.
- **Data:** Neon Postgres and Upstash Redis from the Vercel Marketplace, plus a private
  Vercel Blob store for uploads. Each one injects its env vars (`DATABASE_URL`,
  `REDIS_URL`, `BLOB_READ_WRITE_TOKEN`).
- **No worker process.** With `VERCEL=1`, the API defaults to `INGEST_MODE=inline` (it
  ingests in the background after answering the upload, with the worker's retry policy),
  `STORAGE_DRIVER=blob`, `MAX_UPLOAD_MB=4` (Vercel rejects request bodies over 4.5 MB) and
  `TRUST_PROXY=1`. If a function dies mid-ingestion, the document is restarted the next
  time the dashboard lists documents.

Setting it up from scratch with the Vercel CLI:

```bash
vercel link
vercel project update --framework services --node-version 22.x
vercel integration add neon                  # accept the terms in the browser when asked
vercel integration add upstash/upstash-kv
vercel blob create-store docspilot-uploads --access private --yes
vercel env add JWT_SECRET production         # 32+ random characters
vercel env add ADMIN_EMAILS production
# Migrations don't run on deploy: run them against Neon's direct (unpooled) URL,
# and again whenever apps/api/migrations changes.
DATABASE_URL="<DATABASE_URL_UNPOOLED from vercel env pull>" npm run migrate
vercel deploy --prod
```

For real answers, add `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (and optionally
`EMBEDDING_PROVIDER=voyage` + `VOYAGE_API_KEY`, then re-upload documents) with
`vercel env add`, and redeploy.

## Production checklist

- [ ] HTTPS in front of `web`; internal ports not published
- [ ] Strong, unique `JWT_SECRET`
- [ ] `ADMIN_EMAILS` set to operators only
- [ ] Provider keys set (or mocks, intentionally)
- [ ] Database backups scheduled
- [ ] Each tenant's allowed widget domains set (widgets are off until then)
- [ ] Optional hardening: connect the app as a non-owner Postgres role (see ARCHITECTURE.md → Key tradeoffs)
