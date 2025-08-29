import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  // Allow warnings without failing CI/lint tasks
  { linterOptions: { reportUnusedDisableDirectives: true } },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022,
      }
    },
  rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-console': 'off',
  // Allow intentionally empty catch blocks used throughout the codebase
  'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    files: ['src/public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.es2022
      }
    },
    rules: {
  'no-unused-vars': ['off', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-console': 'off',
  // Allow intentionally empty catch blocks in browser code paths
  'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
];
