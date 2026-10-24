/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute API origin, e.g. https://api.yourdomain.in
   *
   * Empty on the web (same-origin requests via the dev proxy or the
   * production rewrite). REQUIRED for the packaged Android app, which has no
   * proxy and cannot resolve a relative /api path.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
