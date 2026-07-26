/// <reference types="vite/client" />

/** Injected by Vite from package.json. Shown in Settings → About. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Google OAuth Web client ID. Absent in the demo build. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
