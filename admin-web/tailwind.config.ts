import type { Config } from 'tailwindcss';

/**
 * Tokens del sistema de diseño Pernexium (docs/design-system.md §2).
 *
 * `theme.colors` se REEMPLAZA (no `extend`): la paleta Tailwind por defecto
 * (`bg-blue-500`, `text-gray-700`, ...) no genera CSS. Solo se agregan
 * `red/green 50/700` porque el propio design system (§7.5) los usa en
 * mensajes inline.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      white: '#FFFFFF',
      primary: {
        DEFAULT: '#145CB3',
        foreground: '#FFFFFF',
        // navy → casi negro (hover, pressed, fondos oscuros)
        10: '#1253A1',
        20: '#104A8F',
        30: '#0E417D',
        40: '#0C386B',
        50: '#0A2E5A',
        60: '#082548',
        70: '#061C36',
        80: '#041224',
        90: '#020912',
        // celestes → blanco azulado (badges, fondos suaves, hover claro)
        light: {
          10: '#2C6CBB',
          20: '#437DC2',
          30: '#5B8DCA',
          40: '#729DD1',
          50: '#8AAED9',
          60: '#A1BEE1',
          70: '#B9CEE8',
          80: '#D0DEF0',
          90: '#EAF2FB',
        },
      },
      secondary: {
        DEFAULT: '#27A3D7',
        foreground: '#FFFFFF',
        light: {
          10: '#3CACDB',
          20: '#52B5DF',
          30: '#68BFE3',
          40: '#7DC8E7',
          50: '#93D1EB',
          60: '#A9DAEF',
          70: '#BEE3F3',
          80: '#D4EDF7',
          90: '#EAF6FB',
        },
      },
      error: {
        DEFAULT: '#56070C',
        10: '#F9E8E9',
        60: '#D71B28',
        70: '#B3131F',
      },
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
      // Solo para mensajes inline (design-system §7.5).
      red: { 50: '#FEF2F2', 700: '#B91C1C' },
      green: { 50: '#F0FDF4', 700: '#15803D' },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        heading: ['Jost', 'var(--font-inter)', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      boxShadow: {
        card: '0 1px 2px rgba(6, 65, 124, 0.04), 0 4px 16px rgba(6, 65, 124, 0.05)',
      },
      borderColor: {
        DEFAULT: '#DCE4EB',
        input: '#D3DCE5',
      },
      ringColor: {
        DEFAULT: '#27A3D7',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        enter: {
          from: { opacity: '0', transform: 'translateY(-10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        leave: {
          from: { opacity: '1', transform: 'translateY(0)' },
          to: { opacity: '0', transform: 'translateY(-10px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        fadeIn: 'fadeIn 200ms ease-out',
        enter: 'enter 250ms ease-out',
        leave: 'leave 200ms ease-in forwards',
        shimmer: 'shimmer 1.5s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
