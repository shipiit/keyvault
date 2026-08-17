import js from '@eslint/js';

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
