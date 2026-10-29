import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages project sites
// (https://<user>.github.io/<repo>/) and from any sub-path without
// broken asset URLs.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0, // keep .glb/.usdz as real files, never inlined
  },
  server: {
    host: true, // expose on LAN for on-device testing over https tunnels
  },
});
