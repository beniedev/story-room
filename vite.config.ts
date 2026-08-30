import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { sites } from '@openai/sites-vite-plugin';
import hostingConfig from './.openai/hosting.json' with { type: 'json' };

const apiHost = process.env.STORY_API_HOST ?? '127.0.0.1';
const apiPort = process.env.STORY_API_PORT ?? '4311';

export default defineConfig(async ({ mode }) => {
  const siteBuild = mode === 'site';
  const plugins: PluginOption[] = [react()];

  if (siteBuild) {
    const { cloudflare } = await import('@cloudflare/vite-plugin');
    plugins.push(
      sites(),
      cloudflare({
        config: {
          name: 'server',
          main: './worker/index.ts',
          compatibility_date: '2026-08-30',
          compatibility_flags: ['nodejs_compat'],
          d1_databases: hostingConfig.d1 ? [{
            binding: hostingConfig.d1,
            database_name: 'story-native-writing-demo',
            database_id: '00000000-0000-4000-8000-000000000000',
          }] : [],
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
        '/api': `http://${apiHost}:${apiPort}`,
      },
    },
  };
});
