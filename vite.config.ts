import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

const apiHost = process.env.STORY_API_HOST ?? '127.0.0.1';
const apiPort = process.env.STORY_API_PORT ?? '4311';

export const formatUrlHost = (value: string) => {
  const hostname = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  return hostname.includes(':') ? `[${hostname}]` : hostname;
};

export default defineConfig(async ({ mode }) => {
  const siteBuild = mode === 'site';
  const plugins: PluginOption[] = [react()];

  if (siteBuild) {
    const { cloudflare } = await import('@cloudflare/vite-plugin');
    plugins.push(
      cloudflare({
        config: {
          name: 'server',
          main: './worker/index.ts',
          compatibility_date: '2026-08-30',
          compatibility_flags: ['nodejs_compat'],
          assets: {
            not_found_handling: 'single-page-application',
            run_worker_first: ['/api/*'],
          },
        },
      }),
    );
  }

  return {
    plugins,
    server: {
      host: process.env.VITE_HOST ?? '127.0.0.1',
      port: 4310,
      strictPort: true,
      proxy: siteBuild ? undefined : {
        '/api': {
          target: `http://${formatUrlHost(apiHost)}:${apiPort}`,
          changeOrigin: false,
        },
      },
    },
  };
});
