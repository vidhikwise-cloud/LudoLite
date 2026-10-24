# Shipping the app

Two steps: put the server online, then build the Android app against it.

Do them in this order — the app needs a real server URL baked in at build
time, and a phone cannot reach your laptop.

---

## 1. Put it online (Render)

The whole thing runs as **one service**: it serves the API, the websockets,
and the web app from a single origin. No CORS to configure, no proxy rules,
no second service to wire up.

### Push to GitHub

The repo is committed locally. Create an empty repo on GitHub, then:

```powershell
cd c:\Users\Admin\Desktop\accountjalpiintegration\ludolite
git remote add origin https://github.com/YOUR-USERNAME/ludolite.git
git branch -M main
git push -u origin main
```

Nothing sensitive is tracked — `.env`, keystores, and `node_modules` are all
ignored. Verify with `git ls-files | findstr .env` (should show only
`.env.example`).

### Deploy

1. [dashboard.render.com](https://dashboard.render.com) → **New** →
   **Blueprint**
2. Pick the repo. Render reads [`render.yaml`](../render.yaml) and shows a
   Postgres database and one web service.
3. **Apply**. First deploy takes 5–10 minutes.

Render creates the database, runs the migration, seeds the compliance rows as
`not_started`, and starts the server.

When it finishes you get a URL like `https://ludo.onrender.com` — **that is
the app**. Open it and play.

### What it costs

| | Plan | Why |
|---|---|---|
| Web service | Starter | The free tier sleeps, and a sleeping server drops every live match mid-game. |
| Postgres | Basic 256MB | The free tier is deleted after 30 days. |

Change these in `render.yaml` before applying if you want to accept those
trade-offs for testing.

### Checks after it is up

```
https://your-url.onrender.com/health   -> {"ok":true,...}
https://your-url.onrender.com/ready    -> {"ready":true}
```

The logs should show:

```
paid hosting is DISABLED — free private matches only
```

That is correct. See [COMPLIANCE.md](COMPLIANCE.md).

---

## 2. Build the Android app

### Install the toolchain, once

[Android Studio](https://developer.android.com/studio). It bundles the JDK
and the SDK. Open it once after installing so it finishes downloading the
SDK, then **open a new terminal** so the environment picks it up.

### Build

```powershell
cd c:\Users\Admin\Desktop\accountjalpiintegration\ludolite
powershell -ExecutionPolicy Bypass -File .\scripts\build-app.ps1 -ApiUrl "https://your-url.onrender.com"
```

That builds the web bundle pointed at your server, regenerates the icons,
syncs into the Android project, and runs Gradle. First run downloads Gradle,
so give it a few minutes.

Output: `apps\web\android\app\build\outputs\apk\release\app-release.apk`

Copy it to your phone and open it. Android will ask you to allow installs
from unknown sources.

### One thing to change on Render

The Android webview loads from `https://localhost`, so its API calls are
cross-origin. In the Render dashboard, set:

```
CORS_ORIGINS = https://localhost
```

Without this the app installs and opens but cannot reach the server.

### Guards in the build script

It refuses to build with a URL that would produce a broken app:

- not HTTPS — Android blocks cleartext in this configuration
- `localhost` — a phone cannot reach your laptop
- missing — a relative path has nothing to resolve against

It warns, but continues, if the server is not reachable yet.

---

## 3. Play Store (optional)

Sideloading the APK is enough to play with friends. The store is only needed
for public distribution.

### Sign it properly

```powershell
cd c:\Users\Admin\Desktop\accountjalpiintegration\ludolite
keytool -genkey -v -keystore ludo-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias ludo-upload
```

**Back that file up.** Losing it means losing the ability to update your own
app without Google's key-reset process.

Copy `apps\web\android\keystore.properties.example` to `keystore.properties`
in the same folder and fill in your passwords. It is gitignored.

Then build a bundle:

```powershell
.\scripts\build-app.ps1 -ApiUrl "https://your-url.onrender.com" -Bundle
```

Output: `app-release.aab`.

Without `keystore.properties` the release build falls back to the debug key —
installable for testing, rejected by Play.

### Before uploading

See [ANDROID.md](ANDROID.md) for the full checklist. The ones people miss:

- **Privacy policy URL** — must be publicly reachable. Your deployed app
  serves one at `/` → Privacy; link that page.
- **Data safety form** — collected: a display name you choose, and a random
  device identifier. Not collected: email, phone, location, contacts,
  financial info.
- **versionCode** must increase on every upload, in
  `apps\web\android\app\build.gradle`.

### Before the Android build ever charges anything

Separate from the above, and non-optional: review Google Play's current
policy on paid digital access and on real-money gaming, and complete the Play
declarations. Taking a payment inside an Android app is a different question
from taking it on the web. [COMPLIANCE.md §5](COMPLIANCE.md).

---

## Updating

**Server**: push to `main`. Render redeploys automatically, runs migrations
first, and drains gracefully so players mid-match reconnect rather than
seeing an error.

**App**: re-run `build-app.ps1`. Bump `versionCode` first if it is going to
Play.

---

## If something is wrong

**App opens to a blank screen** — almost always the API URL or CORS. Check
`CORS_ORIGINS` includes `https://localhost` on Render.

**"Could not reach the server"** — open `https://your-url.onrender.com/ready`
in a browser. If that fails, the server or database is down; check the Render
logs.

**Matches freeze after a few minutes** — the web service is on the free tier
and sleeping. Upgrade to Starter.

**Gradle cannot find a JDK** — Android Studio bundles one:
`$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"`

**Play rejects the upload: versionCode already used** — increment it in
`app\build.gradle`. It must rise even for a re-upload of the same version.
