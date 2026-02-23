/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: '#1e1e1e',
          secondary: '#252526',
          tertiary: '#2d2d30',
        },
        foreground: {
          DEFAULT: '#cccccc',
          muted: '#969696',
          subtle: '#6c6c6c',
        },
        border: {
          DEFAULT: '#3e3e42',
          focus: '#007acc',
        },
        sidebar: {
          DEFAULT: '#252526',
          foreground: '#cccccc',
          border: '#3e3e42',
        },
        editor: {
          DEFAULT: '#1e1e1e',
          foreground: '#cccccc',
          lineNumbers: '#858585',
          selection: '#264f78',
        },
        chat: {
          DEFAULT: '#252526',
          input: '#3c3c3c',
          userMessage: '#0e639c',
          aiMessage: '#1e1e1e',
        },
        success: '#4ec9b0',
        warning: '#ce9178',
        error: '#f48771',
        info: '#75beff',
      },
      fontFamily: {
        mono: ['Consolas', 'Monaco', 'Courier New', 'monospace'],
        sans: ['Segoe UI', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-in-out',
        'slide-in': 'slideIn 0.3s ease-out',
        'pulse-subtle': 'pulseSubtle 2s infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { transform: 'translateX(-10px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.8' },
        },
      },
    },
  },
  plugins: [],
}
