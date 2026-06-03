/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ['var(--font-serif)', 'Playfair Display', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'Plus Jakarta Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: {
          50: '#f0f7f9',
          100: '#dbeff2',
          200: '#bce0e6',
          300: '#8ec9d4',
          400: '#5aa6b5',
          500: '#165a6a',
          600: '#0f4a56',
          700: '#0c343d',
          800: '#082329',
          900: '#041114',
          950: '#020708',
        },
      },
    },
  },
  plugins: [],
};
