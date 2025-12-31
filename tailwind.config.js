/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      // Hand-Drawn Color Palette
      colors: {
        paper: '#fdfbf7',        // Warm paper background
        pencil: '#2d2d2d',       // Soft pencil black (never pure black)
        muted: '#e5e0d8',        // Old paper / erased pencil
        accent: '#ff4d4d',       // Red correction marker
        'blue-pen': '#2d5da1',   // Blue ballpoint pen
      },
      // Handwritten Fonts
      fontFamily: {
        hand: ['Kalam', 'cursive'],           // For headings
        handwriting: ['Patrick Hand', 'cursive'], // For body text
      },
      // Hard Offset Shadows (no blur)
      boxShadow: {
        'hand': '4px 4px 0px 0px #2d2d2d',
        'hand-lg': '8px 8px 0px 0px #2d2d2d',
        'hand-sm': '2px 2px 0px 0px #2d2d2d',
        'hand-subtle': '3px 3px 0px 0px rgba(45, 45, 45, 0.1)',
      },
      // Custom Border Radius for Wobbly Effect
      borderRadius: {
        'wobbly': '255px 15px 225px 15px / 15px 225px 15px 255px',
        'wobbly-md': '15px 255px 15px 225px / 225px 15px 255px 15px',
        'wobbly-sm': '185px 25px 205px 25px / 25px 205px 25px 185px',
      },
      // Playful Animations
      animation: {
        'bounce-slow': 'bounce-slow 3s ease-in-out infinite',
        'jiggle': 'jiggle 0.3s ease-in-out',
      },
      keyframes: {
        'bounce-slow': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'jiggle': {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '25%': { transform: 'rotate(-1deg)' },
          '75%': { transform: 'rotate(1deg)' },
        },
      },
    },
  },
  plugins: [],
}