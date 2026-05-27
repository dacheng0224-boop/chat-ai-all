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
    if (request.method !== 'POST' || !url.pathname.includes('chat/completions')) {
      return new Response('Not Found', { status: 404, headers: cors });
    }

    const targetBase = (request.headers.get('X-Target-Base-Url') || '').trim().replace(/\/+$/, '');
    if (!targetBase) {
      return Response.json(
        { error: { message: '缺少 X-Target-Base-Url' } },
        { status: 400, headers: cors }
      );
    }

    const auth = request.headers.get('Authorization') || '';
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort('UPSTREAM_TIMEOUT'), 25000);
      let upstream;
      try {
        upstream = await fetch(`${targetBase}/chat/completions`, {
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
      if (e?.name === 'AbortError') {
        return Response.json(
          {
            error: {
              message:
                '自定义代理连接上游超时（25s）。通常是中转站/模型首字过慢或上游不通，请检查中转站连通性。',
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
