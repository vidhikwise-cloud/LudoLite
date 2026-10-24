# Android release

The Android app is a Capacitor wrapper around the same web bundle, so the
room and payment rules are identical on both platforms by construction.

---

## One-time setup

You need **Android Studio** (which brings the SDK and JDK 17).

```powershell
cd apps\web
npm run android:add
```

That creates `apps/web/android/`. It is gitignored for build outputs but the
project files themselves should be committed once you are happy with them.

---

## Building

The packaged app has no dev proxy, so it must know the API's absolute URL.
The build **refuses to run** without it:

```powershell
$env:VITE_API_BASE_URL = "https://api.yourdomain.in"
npm run android:sync
npm run android:open     # opens Android Studio
```

The guard rejects a missing URL, a non-HTTPS URL, and `localhost` — all three
produce an app that silently cannot reach the server.

---

## Signing a release

Play requires a signed build. Create an upload key **once** and never lose it:

```powershell
keytool -genkey -v -keystore ludo-upload.jks -keyalg RSA -keysize 2048 `
  -validity 10000 -alias ludo-upload
```

Store `ludo-upload.jks` somewhere safe and backed up. **If you lose it you
cannot update your own app** without Play's key-reset process.

Create `apps/web/android/keystore.properties` — this file must never be
committed:

```properties
storeFile=../../ludo-upload.jks
storePassword=<your password>
keyAlias=ludo-upload
keyPassword=<your password>
```

Then edit `apps/web/android/app/build.gradle` and add inside `android { }`:

```gradle
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('keystore.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

signingConfigs {
    release {
        if (keystorePropertiesFile.exists()) {
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
        }
    }
}

buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled true
        shrinkResources true
        proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'),
                      'proguard-rules.pro'
    }
}
```

Also set the version there for each release:

```gradle
defaultConfig {
    versionCode 1          // must increase on every upload
    versionName "1.0.0"
}
```

Build the bundle Play wants:

```powershell
npm run android:aab
```

Output: `apps/web/android/app/build/outputs/bundle/release/app-release.aab`

---

## Play Console checklist

Before your first upload:

- [ ] Developer account created (one-time fee, identity verification).
- [ ] App icons — Capacitor generates from `apps/web/public/icon-512.png`; a
      512×512 PNG is also needed for the store listing.
- [ ] Feature graphic, 1024×500.
- [ ] At least two phone screenshots.
- [ ] Short and full description.
- [ ] **Privacy policy URL** — must be publicly reachable. The app has a
      privacy page; host it at a stable URL and link that.
- [ ] **Data safety form.** For this build, answer honestly:
      - Collected: a display name you choose, and a random device identifier.
      - Not collected: email, phone, location, contacts, photos, financial
        info.
      - Data is encrypted in transit, and users can request deletion.
- [ ] Content rating questionnaire.
- [ ] Target audience — **not** children, unless you complete the Families
      policy requirements.

### Before the Android build ever charges anything

Separate from the above, and non-optional:

- [ ] Review Google Play's **current** policy on paid digital access, and
      whether Play Billing is required for a ₹1 hosting fee.
- [ ] Review Play's real-money-gaming policy and its India-specific terms.
- [ ] Confirm whether a web payment is permitted for this content type, or
      whether it would be a policy violation.

Taking a payment inside an Android app is a different question from taking it
on the web. See [COMPLIANCE.md §5](COMPLIANCE.md).

---

## Testing before release

1. **Internal testing track** — up to 100 testers by email, no review wait.
2. **Closed testing** — needed if you later want production access.
3. Test on a real device over mobile data, not just Wi-Fi: it is the fastest
   way to find hardcoded localhost URLs and mixed-content failures.

---

## Troubleshooting

**App loads a blank screen** — almost always `VITE_API_BASE_URL`. Check it was
set when you ran `android:sync`, and that the API is reachable over HTTPS.

**Cleartext traffic blocked** — the config requires HTTPS. A self-signed or
http:// API will be refused.

**Gradle cannot find a JDK** — Android Studio bundles JDK 17; set
`JAVA_HOME` to it or run builds from inside Studio.

**Upload rejected: versionCode already used** — increment `versionCode` in
`app/build.gradle`. It must rise on every upload, even for a re-upload.
