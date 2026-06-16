export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Target-Base-Url',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS });
  }

  const targetBase = (req.headers.get('x-target-base-url') || '').trim().replace(/\/+$/, '');
  if (!targetBase) {
    return Response.json(
      { error: { message: '缺少 X-Target-Base-Url，请在设置中填写 Base URL' } },
      { status: 400, headers: CORS }
    );
  }

  const auth = req.headers.get('authorization') || '';
  const contentType = req.headers.get('content-type');
  const upstream = `${targetBase}/images/edit`;

  try {
    const resp = await fetch(upstream, {
      method: 'POST',
      headers: {
        ...(contentType ? { 'Content-Type': contentType } : {}),
        Authorization: auth,
      },
      body: req.body,
    });

    const headers = new Headers(CORS);
    const ct = resp.headers.get('content-type');
    if (ct) headers.set('Content-Type', ct);
    headers.set('Cache-Control', 'no-cache');

    return new Response(resp.body, { status: resp.status, headers });
  } catch (e) {
    return Response.json(
      { error: { message: `无法连接中转站：${e.message || '网络错误'}` } },
      { status: 502, headers: CORS }
    );
  }
}
