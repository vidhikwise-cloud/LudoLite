# Running it

Everything here is the **free** experience. Paid hosting is disabled and
cannot be switched on by configuration alone — see
[COMPLIANCE.md](COMPLIANCE.md).

---

## First time

One command. It will ask for your PostgreSQL password.

```powershell
cd c:\Users\Admin\Desktop\accountjalpiintegration\ludolite
.\scripts\setup.ps1
```

What it does:

1. Connects to PostgreSQL 16 on `localhost:5432`
2. Creates the `ludo` database (skips it if it already exists)
3. Writes `apps/server/.env` with your connection string and a freshly
   generated `SESSION_SECRET`
4. Installs dependencies, generates the Prisma client, applies the migration
5. Seeds the two compliance rows as `not_started`

Your password is typed hidden, used only for this run, and written only into
`apps/server/.env` — which is gitignored. It is never printed.

**Using PostgreSQL 18 instead?** You also have it, on port 5433:

```powershell
.\scripts\setup.ps1 -Port 5433 -PgBin "C:\Program Files\PostgreSQL\18\bin"
```

---

## Every time after that

```powershell
.\scripts\dev.ps1
```

Opens two windows — API server and web client. Then open:

**http://localhost:5173**

The server window prints the paid-hosting state at boot. You should see:

```
  Ludo With Friends -- server on :4000
  PAID HOSTING: DISABLED
  Free private matches are available. Paid hosting is blocked by:
    - PAID_ROOM_HOSTING_ENABLED is false
    - No payment provider is configured (PAYMENT_PROVIDER=none)
    - Legal review is "not_started" ...
    - Payment provider approval is "not_started" ...
```

That output is the system working correctly, not an error.

---

## Check it actually works

With the server running, in a third terminal:

```powershell
.\scripts\verify.ps1
```

It creates a real room over HTTP, joins it with a second player, and confirms
a paid room is refused with `402`. Six checks; all should pass.

---

## Play with friends on your Wi-Fi

Ludo needs four people to be worth testing. To let phones on the same network
join:

```powershell
.\scripts\share.ps1
```

It prints a `http://192.168.x.x:5173` URL to share. On their phones they can
add it to the home screen to install the PWA.

**First run only**, in an **Administrator** PowerShell:

```powershell
New-NetFirewallRule -DisplayName 'Ludo dev (LAN)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173,4000 -Profile Private
```

Without that rule Windows silently blocks the phones and the page just never
loads.

---

## Android

```powershell
cd apps\web
npm run android:add      # once -- creates the android/ project
npm run android:sync     # build web + copy into it
npm run android:open     # opens Android Studio
```

The Android app loads the same web bundle, so there is one implementation of
the rules across both platforms.

Review Google Play's current policy before the Android build ever charges
anything — [COMPLIANCE.md §5](COMPLIANCE.md).

---

## Public deploy (Render)

[`render.yaml`](../render.yaml) is ready. Push the repo to GitHub, then in
Render: **New -> Blueprint -> select the repo**. It creates the Postgres
database, the API service, and the static web client.

Two things to know:

- The API needs a **paid instance** — Render's free tier sleeps, which kills
  websocket connections and therefore live matches.
- After the first deploy, replace `ludo-api.onrender.com` in the `routes`
  section with your actual API URL.

`PAID_ROOM_HOSTING_ENABLED` is pinned to `false` in the blueprint.

---

## Troubleshooting

**"psql.exe not found"** — pass the right folder:
`.\scripts\setup.ps1 -PgBin "C:\Program Files\PostgreSQL\18\bin"`

**"Port 4000 is already in use"** — `dev.ps1` prints the PID. Stop it with
`Stop-Process -Id <pid>`.

**"Could not connect"** — check the service is running:
`Get-Service postgresql*`

**Scripts blocked by execution policy** — run them as:
`powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1`

**Want to start the database over** —
`& "C:\Program Files\PostgreSQL\16\bin\dropdb.exe" -U postgres ludo`
then re-run setup.

**Phone can't load the LAN URL** — the firewall rule above is missing, or the
phone is on a different network (guest Wi-Fi is a common culprit).
