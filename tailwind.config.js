/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,tsx,ts}'],
  theme: {
    extend: {
      colors: {
        gray: {
          850: '#1a1f2e',
          950: '#0d1117',
        }
      }
    },
  },
  plugins: [],
}
