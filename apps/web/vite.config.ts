import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In `pnpm dev` we keep `base: '/'` so the dev server stays at the root.
// In `pnpm build` we set `base: '/systemdynamicsdiagram/'` because GitHub
// Pages serves the repo at `banbinal.github.io/systemdynamicsdiagram/`.
// The `VITE_BASE` env var lets CI override this (e.g. for a custom domain).
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base:
    process.env['VITE_BASE'] ??
    (command === 'build' ? '/systemdynamicsdiagram/' : '/'),
  server: {
    port: 5174,
    strictPort: false,
  },
}));
