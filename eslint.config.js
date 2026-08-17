import js from '@eslint/js';
import react from 'eslint-plugin-react';

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        crypto: 'readonly',
        console: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        structuredClone: 'readonly',
        CryptoKey: 'readonly',
      },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The extension layers may use Chrome APIs; src/core may not.
    files: ['src/background/**/*.js', 'src/content/**/*.js', 'src/ui/**/*.{js,jsx}'],
    plugins: { react },
    rules: {
      // Without this, every component referenced only from JSX is reported
      // as unused.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off',
    },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        chrome: 'readonly',
        console: 'readonly',
        // Browser and worker globals. Available in the extension layers but
        // deliberately still forbidden inside src/core, which must run in
        // plain Node so the cryptography stays auditable without a browser.
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        navigator: 'readonly',
        document: 'readonly',
        window: 'readonly',
        globalThis: 'readonly',
        localStorage: 'readonly',
        Element: 'readonly',
        Node: 'readonly',
        Event: 'readonly',
        HTMLInputElement: 'readonly',
        MutationObserver: 'readonly',
        XMLSerializer: 'readonly',
        Image: 'readonly',
        ImageData: 'readonly',
        queueMicrotask: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        CSS: 'readonly',
        Promise: 'readonly',
      },
    },
  },
  {
    // Build scripts run in Node, not the browser.
    files: ['scripts/**/*.js'],
    languageOptions: {
      globals: { Buffer: 'readonly', process: 'readonly', console: 'readonly' },
    },
  },
  {
    // End-to-end specs run in Node (Playwright's runner) but contain small
    // functions that are serialised and evaluated inside the browser, so both
    // sets of globals are legitimate in one file.
    files: ['tests/e2e/**/*.js', 'playwright.config.js'],
    rules: {
      // `async ({}, use) => …` is Playwright's own fixture signature.
      'no-empty-pattern': 'off',
    },
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        self: 'readonly',
      },
    },
  },
  {
    // Component and content-script tests run under jsdom.
    files: ['tests/content/**/*.js', 'tests/ui/**/*.{js,jsx}'],
    plugins: { react },
    rules: {
      // Components rendered only inside JSX are otherwise reported unused.
      'react/jsx-uses-vars': 'error',
    },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        document: 'readonly',
        window: 'readonly',
        HTMLInputElement: 'readonly',
        Element: 'readonly',
        Node: 'readonly',
        Event: 'readonly',
        KeyboardEvent: 'readonly',
        DOMParser: 'readonly',
        Image: 'readonly',
        queueMicrotask: 'readonly',
        Uint8ClampedArray: 'readonly',
        HTMLCanvasElement: 'readonly',
        CSS: 'readonly',
      },
    },
  },
  {
    // src/core is the security-critical layer. Keeping it free of browser and
    // extension APIs is what lets a reviewer audit the cryptography by
    // running `npm test`, with no Chrome involved.
    files: ['src/core/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/background/**', '**/ui/**', '**/content/**'],
              message:
                'src/core must stay pure: no imports from background, ui, or content. ' +
                'This keeps the security-critical code testable in plain Node.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'chrome', message: 'src/core must not use Chrome extension APIs.' },
        { name: 'window', message: 'src/core must not use DOM APIs.' },
        { name: 'document', message: 'src/core must not use DOM APIs.' },
        { name: 'fetch', message: 'src/core must not make network requests.' },
        { name: 'XMLHttpRequest', message: 'src/core must not make network requests.' },
        { name: 'localStorage', message: 'src/core must not touch persistent storage.' },
      ],
    },
  },
];
