import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [react()],
  build: {
    /*
     * The webview Pigeon runs in, not the browser that built it.
     *
     * The CSS minifier rewrites what it can to whatever the target supports,
     * and left to its default it turned every phone query into Media Queries
     * Level 4 range syntax — `@media (width<=719px),(height<=449px)`. Safari
     * has understood that since 16.4. `bundle.iOS.minimumSystemVersion` is
     * 14.0, so on an iPhone one major version behind, every one of those rules
     * would have been dropped on the floor: the tab bar would render over a
     * layout still sized for a rail, and nothing would have said why.
     *
     * safari14 keeps the syntax those webviews can read. Raise both together
     * or neither.
     */
    cssTarget: 'safari14',
  },
  // Settings → About shows the version. Injecting it at build time keeps
  // package.json out of the client bundle.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
});
