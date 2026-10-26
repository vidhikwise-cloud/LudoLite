import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android wrapper configuration.
 *
 * The Android app loads the same built web bundle, so there is exactly one
 * implementation of the room and payment rules across both platforms. A rule
 * cannot hold on the web and leak on Android, because there is no second
 * client to drift.
 *
 * IMPORTANT -- before enabling paid hosting in the Android build:
 *
 * Google Play's current policy on paid digital access and on real-money
 * gaming must be reviewed against the shipping build, and the Play Console
 * declarations completed. Charging for digital access inside an Android app
 * generally engages Play Billing policy, which is a materially different
 * question from taking a web payment. See docs/COMPLIANCE.md.
 */
const config: CapacitorConfig = {
  appId: 'in.ludolite.app',
  appName: 'LudoLite',
  webDir: 'dist',

  android: {
    // All traffic must be HTTPS. Cleartext is rejected outright.
    allowMixedContent: false,
    captureInput: true,
    // Keep the webview's own back-forward cache off: the game is live state,
    // and a restored page would show a stale board.
    webContentsDebuggingEnabled: false,
  },

  server: {
    androidScheme: 'https',
    // The packaged app has no dev proxy, so it must call the API by absolute
    // URL. VITE_API_BASE_URL at build time drives this; see src/lib/api.ts.
    cleartext: false,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: '#FBF7F2',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
  },
};

export default config;
