# Ludo With Friends

**Play Ludo with friends. ₹1 per match hosted. Zero paid ads.**

Only the room creator pays ₹1 to host a match. Everyone they invite joins
free. A four-player match produces ₹1 of gross revenue, not ₹4. No
subscriptions, no paid ads, and no cash prizes — winning returns the result
and nothing else.

> **Paid hosting is disabled by default and cannot be enabled by configuration
> alone.** It additionally requires a written Indian gaming-law opinion and
> written payment-provider approval, both recorded in the database. No legal
> approval has been obtained and no provider has approved this model.
> See [docs/COMPLIANCE.md](docs/COMPLIANCE.md).

---

## What runs today

Free private matches, end to end:

- Create a private room, get a 4-character invite code.
- Friends join by code or link, at no charge.
- Real-time multiplayer; dice, turns, moves, and results are decided by the
  server.
- Drop your connection and come back to the same seat.
- Installable PWA on the web, plus an Android wrapper that loads the same
  bundle — so both platforms enforce one set of rules.

No payment UI is rendered anywhere while the gate is shut. Not a price, not a
fee line, not a disabled pay button.

---

## Layout

```
packages/engine    Pure Ludo rules. No I/O, no randomness, fully deterministic.
packages/shared    Wire contracts imported by the server and both clients.
apps/server        Express + Socket.IO + Prisma. Owns all game and money state.
apps/web           React PWA. Also the Android app, via Capacitor.
docs/COMPLIANCE.md The legal and provider gate. Read before touching payments.
docs/SHIP.md       Deploy to Render, then build the Android app.
docs/RUNNING.md    Local setup and troubleshooting.
docs/ANDROID.md    Play Store release details.
docs/OPERATIONS.md Running it in production.
```

In production the Node service serves the API, the websockets, **and** the
web client from one origin — so there is no CORS to configure, no proxy
between services, and nothing to rewire after the first deploy.

The engine is shared so the client can predict and highlight legal moves,
while the server stays the only authority on what actually happened.

---

## Running it

Requires Node 20+ and a Postgres database.

```bash
npm install

# Configure
cp .env.example apps/server/.env
#   edit DATABASE_URL and SESSION_SECRET

# Database
npm run db:generate --workspace apps/server
npm run db:migrate  --workspace apps/server
npm run db:seed     --workspace apps/server   # seeds approvals as not_started

# Run (two terminals)
npm run dev:server    # :4000
npm run dev:web       # :5173
```

The server prints the paid-hosting state and its blockers at boot.

### Android

```bash
cd apps/web
npm run android:add     # once
npm run android:sync    # build web + copy into the Android project
npm run android:open    # open in Android Studio
```

Check Google Play's current requirements before enabling paid digital access
in the Android build — see [docs/COMPLIANCE.md](docs/COMPLIANCE.md) §5.

---

## Tests

```bash
npm test                              # everything
npm test --workspace packages/engine  # rules
npm test --workspace apps/server      # payments, webhooks, gameplay
npm test --workspace apps/web         # UI and board geometry
```

Server tests run against a real SQLite database created per test file, so the
unique constraints that enforce "the host is charged at most once" are
genuinely exercised rather than mocked.

---

## How money is kept safe

Even though nothing can be charged today, the architecture is built as if it
could be:

**One gate, one place.** `apps/server/src/payments/gate.ts` is the only code
that may conclude money can be taken. Everything else asks it.

**Charged at most once.** Every hosting fee carries an idempotency key of
`host_fee:<roomId>:<playerId>` under a UNIQUE index. A retry, a double-tap, a
reconnect, or a refresh returns the original transaction. There is no code
path that creates a second charge for a room.

**The server activates rooms, not the client.** A paid room is created in
`pending_payment` and only moves to `active` when the server has verified the
payment itself. A client POSTing "payment succeeded" is treated as a hint and
re-verified; if the signature does not check out, the room stays inactive no
matter what the user's screen said.

**Webhooks are the authority.** Signatures are checked against the raw request
bytes before parsing. Deliveries are deduplicated on `(provider, eventId)`, so
a provider retry settles once. A capture reporting an amount different from
the one ordered is refused.

**Joining is free, structurally.** `joinRoom` takes no payment parameter,
performs no fee lookup, and creates no transaction. Joining cannot cost money
because there is nothing in that path that could charge.

**Everything is audited.** Gate denials record the exact blockers. Orders,
verifications, failures, refunds, and webhooks are all logged. Secrets and
signatures never are.

**Results carry no payout.** The match record stores a winning seat and
player. There is no balance, wallet, or payout column to credit.

---

## Configuration

See [.env.example](.env.example). The one that matters:

```bash
PAID_ROOM_HOSTING_ENABLED=false
```

Setting this to `true` does **not** enable payments on its own. The two
approval records must also be present with evidence references. That is
deliberate — see [docs/COMPLIANCE.md](docs/COMPLIANCE.md) §2.

```bash
npm run approvals:status --workspace apps/server
```

---

## Licence

Not yet determined.
