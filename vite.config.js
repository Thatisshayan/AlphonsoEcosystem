import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react-dom')) return 'react-dom';
          if (id.includes('/react/')) return 'react';
          if (id.includes('lucide-react')) return 'lucide-react';
          if (id.includes('@tauri-apps/api')) return 'tauri-api';
          return 'vendor';
        }
      }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setupTests.js',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: {
        lines: 12
      }
    }
  }
})
