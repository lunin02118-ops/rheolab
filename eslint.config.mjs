import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "scripts/**",
      "src/rust/**/pkg/**",
      "src-tauri/**",
      "node_modules/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "outputs/**",
      ".next/**",
      ".agent/**",
      ".sisyphus/**",
      "website/**",
      "license-server/**",
      "runtime/**",
      "e2e/**",
      "tests/e2e/_archived/**",
      "docs/**",
      "Regents/**",
    ]
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      "@typescript-eslint/no-unsafe-function-type": "warn",
    }
  },
  {
    // Apply react-hooks rules only to source files, not tests
    files: ["src/**/*.ts", "src/**/*.tsx"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-console": ["warn", { allow: ["warn", "error"] }],
    }
  },
  {
    // Domain modules must use safeInvoke (via './core') instead of raw invoke.
    // Only core.ts itself is allowed to import the raw invoke.
    files: ["src/lib/tauri/*.ts"],
    ignores: ["src/lib/tauri/core.ts", "src/lib/tauri/index.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "./core",
          importNames: ["invoke"],
          message: "Use `safeInvoke as invoke` from './core' for unified error handling.",
        }],
      }],
    },
  },
  {
    // E2E test infrastructure: browser-script injection mocks require dynamic
    // typing with `any` (functions are serialised and executed in browser context).
    // All other rules (no-unused-vars, no-unsafe-function-type) still apply.
    files: ["tests/e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    }
  },
  {
    // Test files: allow `any` for type-casting convenience in fixtures, mocks
    // and converter output assertions. All other rules still apply.
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    }
  },
);
