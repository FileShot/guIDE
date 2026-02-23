import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    cssMinify: true,
    minify: 'esbuild',
    reportCompressedSize: true,
    assetsInlineLimit: 4096,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      },
      external: [
        'electron',
        'node-pty',
        'node-llama-cpp',
        'chokidar',
      ],
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'icons': ['lucide-react'],
          'monaco-editor': ['monaco-editor'],
          'markdown': ['marked', 'mermaid'],
        },
        // Stable chunk file names for better caching
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
    target: 'esnext',
    chunkSizeWarningLimit: 4000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@/components': resolve(__dirname, 'src/components'),
      '@/services': resolve(__dirname, 'src/services'),
      '@/types': resolve(__dirname, 'src/types'),
      '@/utils': resolve(__dirname, 'src/utils'),
      '@/config': resolve(__dirname, 'src/config')
    }
  },
  server: {
    port: 5174,
    strictPort: true,
    watch: {
      ignored: ['**/node_modules/**', '**/*.gguf'],
    },
  },
  optimizeDeps: {
    exclude: ['electron'],
  },
});
