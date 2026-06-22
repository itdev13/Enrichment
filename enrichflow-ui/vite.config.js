import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api and /oauth to the local EnrichFlow API so the UI can run on :5173
// while the backend runs on :3010 without CORS friction.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3010',
      '/oauth': 'http://localhost:3010'
    }
  }
});
