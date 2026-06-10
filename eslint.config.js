// Flat ESLint config (ESLint 9). Typed linting is layered in per-package as code lands;
// at genesis this lints the (currently empty) TS surface and exits 0 with nothing to flag.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'apps/ml/**', // Python service — linted by ruff, not eslint
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // CommonJS config files (e.g. apps/web/next.config.js) — give them Node globals so `module`,
    // `require`, etc. are defined. (The root eslint.config.js itself is ESM and excluded here.)
    files: ['apps/web/**/*.js', '**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        require: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        exports: 'writable',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
