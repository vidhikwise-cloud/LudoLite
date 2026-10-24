/**
 * Guards the Android build.
 *
 * The packaged app has no dev proxy, so a relative `/api` path resolves to
 * the webview's own origin and every request fails. That failure looks like
 * "the app just doesn't work" with nothing useful in the logs, and it is very
 * easy to ship by accident.
 *
 * Fail the build instead.
 */

const url = process.env.VITE_API_BASE_URL;

function die(message) {
  console.error(`\n  Android build blocked: ${message}\n`);
  console.error('  Set the API origin and build again:\n');
  console.error('    $env:VITE_API_BASE_URL = "https://api.yourdomain.in"');
  console.error('    npm run android:sync\n');
  process.exit(1);
}

if (!url || url.trim() === '') {
  die('VITE_API_BASE_URL is not set');
}

let parsed;
try {
  parsed = new URL(url);
} catch {
  die(`VITE_API_BASE_URL is not a valid URL: ${url}`);
}

// Android blocks cleartext traffic in this app's configuration, so an http://
// origin would be rejected at runtime rather than at build time.
if (parsed.protocol !== 'https:') {
  die(`VITE_API_BASE_URL must be https, got ${parsed.protocol}//`);
}

if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
  die('VITE_API_BASE_URL points at localhost, which a phone cannot reach');
}

console.log(`  Android build will call ${parsed.origin}`);
