import { defineConfig } from 'vite';

// The frontend talks to the Flask backend through this dev-server proxy, so
// the app itself only ever calls relative '/api/...' URLs (no hardcoded host).
// In Docker, VITE_PROXY_TARGET is set to http://backend:5000.
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
  },
});
