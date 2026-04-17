import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
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
