import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * Reglas obligatorias del sistema de diseño (docs/design-system.md §11):
 * sin diálogos nativos del navegador y sin <select> nativo.
 */
const designSystemRules = {
  // Nunca HTML crudo (add-legacy-chat-history D4): el contenido de chats se renderiza como texto.
  'react/no-danger': 'error',
  'no-alert': 'error',
  'no-restricted-globals': [
    'error',
    { name: 'alert', message: 'Usa ConfirmDialog o un mensaje inline (design-system §11).' },
    { name: 'confirm', message: 'Usa ConfirmDialog (design-system §11).' },
    { name: 'prompt', message: 'Usa un Dialog con formulario (design-system §11).' },
  ],
  'no-restricted-properties': [
    'error',
    { object: 'window', property: 'alert', message: 'Usa ConfirmDialog o un mensaje inline (design-system §11).' },
    { object: 'window', property: 'confirm', message: 'Usa ConfirmDialog (design-system §11).' },
    { object: 'window', property: 'prompt', message: 'Usa un Dialog con formulario (design-system §11).' },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "JSXOpeningElement[name.name='select']",
      message: 'Usa SearchableSelect o SearchableMultiselect en lugar de <select> nativo (design-system §11).',
    },
  ],
};

const config = [
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'coverage/**', 'test/fixtures/**', 'next-env.d.ts'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      ...designSystemRules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
  {
    files: ['test/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
];

export default config;
