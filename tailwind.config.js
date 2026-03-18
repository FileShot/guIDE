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
      fontSize: {
        'ui-xs': ['10px', { lineHeight: '14px' }],
        'ui-sm': ['11px', { lineHeight: '16px' }],
        'ui': ['12px', { lineHeight: '18px' }],
        'ui-md': ['13px', { lineHeight: '20px' }],
        'ui-lg': ['14px', { lineHeight: '20px' }],
        'ui-xl': ['16px', { lineHeight: '22px' }],
      },
      borderRadius: {
        'ui-sm': '3px',
        'ui': '4px',
        'ui-md': '6px',
        'ui-lg': '8px',
        'ui-xl': '12px',
      },
      boxShadow: {
        'panel': '0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)',
        'dropdown': '0 4px 12px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.3)',
        'modal': '0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
        'subtle': '0 1px 2px rgba(0,0,0,0.15)',
        'glow': '0 0 12px rgba(0,122,204,0.3)',
      },
      spacing: {
        'ui-xs': '2px',
        'ui-sm': '4px',
        'ui': '6px',
        'ui-md': '8px',
        'ui-lg': '12px',
        'ui-xl': '16px',
      },
      transitionDuration: {
        'ui': '150ms',
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-out',
        'slide-in': 'slideIn 0.2s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
        'slide-down': 'slideDown 0.2s ease-out',
        'pulse-subtle': 'pulseSubtle 2s infinite',
        'spin-slow': 'spin 2s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { transform: 'translateX(-8px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(4px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-4px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
    },
  },
  plugins: [],
}
