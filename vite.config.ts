import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiHost = process.env.STORY_API_HOST ?? '127.0.0.1';
const apiPort = process.env.STORY_API_PORT ?? '4311';

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.VITE_HOST ?? '127.0.0.1',
    port: 4310,
    strictPort: true,
    proxy: {
      '/api': `http://${apiHost}:${apiPort}`,
    },
  },
});
