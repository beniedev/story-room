const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { 'cache-control': 'no-store' },
});

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json({ ok: true, storyStorage: 'device-local' });
    }
    return json({ error: '此 DEMO 不在云端保存或处理书稿。' }, 404);
  },
} satisfies ExportedHandler;
