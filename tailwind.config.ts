import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        whatsapp: {
          primary: '#25D366',
          dark: '#075E54',
          light: '#DCF8C6',
        },
      },
    },
  },
  plugins: [],
}
export default config
