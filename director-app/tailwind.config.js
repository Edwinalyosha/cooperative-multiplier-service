/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#0F766E',
        secondary: '#14B8A6',
        accent: '#F59E0B',
        background: '#F8FAFC',
        foreground: '#0F172A',
        success: '#16A34A',
        destructive: '#DC2626',
      },
    },
  },
};
