/**
 * Cloudflare Worker API 代理（无 Vercel 30 秒限制，适合长回复）
 *
 * 部署步骤：
 * 1. 登录 https://dash.cloudflare.com → Workers → Create Worker
 * 2. 粘贴本文件全部内容，Deploy
 * 3. 在聊天工具 设置 → API 连接 → 选「自定义代理」→ 填入 Worker 地址
 *    例如：https://chat-proxy.你的用户名.workers.dev
 */

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Target-Base-Url',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return Response.json({ ok: true, service: 'chat-ai-proxy' }, { headers: cors });
    }
    if (request.method !== 'POST') {
      return new Response('Not Found', { status: 404, headers: cors });
    }
    let upstreamPath = '';
    if (url.pathname.includes('chat/completions')) upstreamPath = '/chat/completions';
    if (url.pathname.includes('images/generations')) upstreamPath = '/images/generations';
    if (!upstreamPath) return new Response('Not Found', { status: 404, headers: cors });

    const targetBase = (request.headers.get('X-Target-Base-Url') || '').trim().replace(/\/+$/, '');
    if (!targetBase) {
      return Response.json(
        { error: { message: '缺少 X-Target-Base-Url' } },
        { status: 400, headers: cors }
      );
    }

    const auth = request.headers.get('Authorization') || '';
    // 生图通常比对话更慢，单独放宽超时
    const timeoutMs = upstreamPath.includes('images') ? 300000 : 120000;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort('UPSTREAM_TIMEOUT'), timeoutMs);
      let upstream;
      try {
        upstream = await fetch(`${targetBase}${upstreamPath}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: auth,
          },
          body: request.body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const headers = new Headers(cors);
      const ct = upstream.headers.get('content-type');
      if (ct) headers.set('Content-Type', ct);
      headers.set('Cache-Control', 'no-cache');

      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (e) {
      const isTimeout =
        e?.name === 'AbortError' ||
        String(e?.message || '').includes('UPSTREAM_TIMEOUT');
      if (isTimeout) {
        const sec = Math.round(timeoutMs / 1000);
        return Response.json(
          {
            error: {
              message:
                `自定义代理连接上游超时（${sec}s）。生图模型可能更慢，请稍后重试；本地调试可改用 serve.rb 启动（超时更长）。`,
            },
          },
          { status: 504, headers: cors }
        );
      }
      return Response.json(
        { error: { message: `无法连接中转站：${e.message}` } },
        { status: 502, headers: cors }
      );
    }
  },
};
