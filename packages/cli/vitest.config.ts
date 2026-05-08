import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Tests in @sysdyn/cli read TypeScript source from @sysdyn/core directly,
 * not the built dist/. This avoids requiring `pnpm build` before `pnpm test`.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globals: false,
    passWithNoTests: true,
    alias: {
      '@sysdyn/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
});
