# Operations

Running Ludo With Friends in production.

---

## Health endpoints

| Path | Question | Use for |
|---|---|---|
| `/health` | Is the process alive? | Liveness probe. No dependency checks, so a database blip never kills a server holding live matches. |
| `/ready` | Can it serve traffic? | Load-balancer routing. Checks the database; returns 503 while draining. |

Point your platform's health check at **`/ready`**, not `/health` — that is
what makes zero-downtime deploys work.

---

## Deploying

### Render

[`render.yaml`](../render.yaml) is a blueprint: push to GitHub, then
**New → Blueprint**. It creates the database, API, and web client.

After the first deploy:

1. Replace `ludo-api.onrender.com` in the web service's `routes` with the
   API's real hostname.
2. Set `CORS_ORIGINS` on the API to the web client's URL.

The API must be on a **paid instance** — the free tier sleeps, and a sleeping
server drops every websocket, which ends every live match.

### Docker

```bash
docker build -t ludo-api .
docker run -p 4000:4000 \
  -e DATABASE_URL=postgresql://... \
  -e SESSION_SECRET=$(openssl rand -hex 48) \
  -e CORS_ORIGINS=https://yourdomain.in \
  ludo-api
```

The image runs as a non-root user, carries no build toolchain or source, and
uses tini so `SIGTERM` reaches Node and the graceful drain actually runs.

---

## Graceful shutdown

On `SIGTERM` the server:

1. Fails `/ready` immediately, so the load balancer stops sending new traffic.
2. Waits 2s for the balancer to notice.
3. Emits `server:shutdown` to connected clients — they show "Server is
   restarting" rather than appearing frozen.
4. Closes websockets, then drains in-flight HTTP (20s cap).
5. Disconnects Prisma and exits 0.

Allow at least **30 seconds** of shutdown grace in your platform config, or
it will `SIGKILL` mid-drain.

---

## Logging

Structured JSON via pino. Every request carries an `x-request-id`, echoed in
the response header, so a user reporting a problem can quote a reference that
appears in the logs.

```bash
LOG_LEVEL=debug   # default: info in production, debug in dev, silent in tests
```

Redacted automatically: authorization headers, player tokens, provider
signatures, device keys, session secrets, `DATABASE_URL`.

Useful queries once logs are aggregated:

```
level="error"                        # anything broken
component="cleanup"                  # housekeeping runs
msg="paid hosting is ENABLED"        # should never appear yet
```

---

## Background cleanup

Runs every 15 minutes. Without it, abandoned rooms hold invite codes out of a
~923k code space.

| Target | After | Action |
|---|---|---|
| Lobby never started | 2 hours | Cancelled, code freed |
| Match with no activity | 3 hours | Ended, code freed |
| Finished/cancelled room | 48 hours | Deleted |
| Player with no rooms | 60 days | Deleted |

**A room with a settled or refunded payment is never deleted**, at any age.
That is financial evidence. Transactions, webhook events, and audit logs are
never deleted by this job at all.

---

## The paid-hosting gate

```bash
npm run approvals:status --workspace apps/server
```

Paid hosting needs all three: the env flag, a `legal_opinion` approval with
evidence, and a `payment_provider` approval with evidence and a matching
provider name. The flag alone does nothing.

CI enforces the defaults — the `gate` job fails the build if `.env.example`
or `render.yaml` ship with payments enabled, if the seed script grants an
approval, or if a payment SDK appears in the server source.

See [COMPLIANCE.md](COMPLIANCE.md).

---

## Rate limits

| Scope | Limit |
|---|---|
| General `/api` | 120/min |
| Room creation | 12/min |
| Room join | 20/min (4-character codes are brute-forceable) |
| Socket actions | 40 per 10s per connection |

`trust proxy` is set to `1`, assuming exactly one proxy in front. If you add
another, update it — otherwise `req.ip` becomes spoofable and the limits stop
working.

---

## Backups

Render's managed Postgres takes daily backups on paid plans. Verify your plan
includes them, and **test a restore before you need one**.

The data worth protecting is `Transaction`, `WebhookEvent`, and `AuditLog`.
Game state is disposable.

---

## Incident checklist

**Players report being frozen mid-match** — check `/ready`. If 503, the
database is unreachable. Clients hold their seats and reconnect automatically.

**"Room not found" for a valid code** — check whether cleanup cancelled it;
search logs for `component="cleanup"`.

**A 500 with a reference id** — search logs for that id to get the full
request context.

**Anything suggesting money moved** — this build cannot take payments. Check
`npm run approvals:status` immediately and search the audit log:

```sql
SELECT * FROM "AuditLog"
WHERE action LIKE 'payment.%' OR action LIKE 'gate.%'
ORDER BY at DESC LIMIT 50;
```
