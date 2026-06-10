// File: tailwind.config
// Created: 2026-06-09
// Updated: 2026-06-09
// Author: Erick Hernández Silva

import type { Config } from 'tailwindcss';

// Tokens del design-system Pernexium. NO hardcodear hex en JSX — usar estos.
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#145CB3',
          foreground: '#FFFFFF',
          light: { 90: '#EAF2FB', 50: '#9CC2EA' },
        },
        secondary: { DEFAULT: '#27A3D7' },
        error: { DEFAULT: '#56070C', 10: '#F9E8E9', 60: '#D71B28', 70: '#B3131F' },
        neutral: {
          10: '#FFFFFF',
          30: '#EEF3F7',
          40: '#E5EBF1',
          50: '#DCE4EB',
          60: '#D3DCE5',
        },
        text: {
          DEFAULT: '#050505',
          muted: '#333333',
          light: { DEFAULT: '#666666', muted: '#999999' },
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        heading: ['Jost', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(6,65,124,0.04), 0 4px 16px rgba(6,65,124,0.05)',
      },
      borderRadius: { '2xl': '1rem' },
    },
  },
  plugins: [],
} satisfies Config;
