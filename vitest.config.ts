import { defineConfig } from 'vitest/config';
import path from 'path';
import fs from 'fs';

// On Windows a lowercase drive letter in cwd (e.g. `d:\...` vs `D:\...`) makes
// Node ESM treat the same files as different module URLs. Vitest then loads two
// copies of @vitest/runner and every suite fails with
// "Cannot read properties of undefined (reading 'config')" /
// "Vitest failed to find the runner". Pin root/cwd to the canonical casing.
const PROJECT_ROOT = fs.realpathSync.native(__dirname);
if (process.platform === 'win32' && process.cwd() !== PROJECT_ROOT) {
    process.chdir(PROJECT_ROOT);
}

export default defineConfig({
    root: PROJECT_ROOT,

    test: {
        // Test environment
        environment: 'node',

        // Environment variables for tests
        env: {
            NODE_ENV: 'test',
            ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'test-encryption-key-32-chars-ok!',
            GROQ_API_KEY: process.env.GROQ_API_KEY || '',
        },

        // Enable global test functions (describe, test, expect)
        globals: true,

        // Include patterns
        include: [
            'tests/**/*.test.ts',
            'tests/**/*.test.tsx',
            'src/**/*.test.ts',
            'src/**/*.test.tsx',
        ],

        // Exclude patterns
        // Live AI tests require a real GROQ_API_KEY — run explicitly with: npm run test:ai
        // AI fixtures also import WASM (RheoParser) which is unavailable in Node environment.
        exclude: [
            'node_modules',
            'dist',
            '.next',
            'tests/e2e/**',
            'tests/ai/**',
        ],

        // Coverage configuration
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            exclude: [
                'node_modules',
                'tests/fixtures',
                '**/*.d.ts',
            ],
        },

        // Per-directory environment overrides
        // @ts-expect-error -- environmentMatchGlobs is valid at runtime but missing from Vitest 4 types
        environmentMatchGlobs: [
            ['tests/hooks/**', 'jsdom'],
            ['tests/components/**', 'jsdom'],
        ],

        setupFiles: ['./tests/setup.ts'],

        // Timeout for tests (AI calls can take up to 60s)
        testTimeout: 60000,

        // Reporter
        reporters: ['verbose'],
    },

    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
