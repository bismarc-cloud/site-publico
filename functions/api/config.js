import { callDriveBridge, jsonResponse } from '../_lib/gdrive.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return jsonResponse({ ok: true });

  try {
    const url = new URL(request.url);
    let slug = (url.searchParams.get('site') || '').trim().toLowerCase();
    const domain = (url.searchParams.get('domain') || request.headers.get('host') || '')
      .trim().toLowerCase().replace(/^www\./, '').split(':')[0];

    // 1. Tenta ler direto do Cloudflare KV (instantâneo)
    if (env.SITES_KV) {
      const index = (await env.SITES_KV.get('sites_index', 'json')) || [];

      if (!slug && domain) {
        const match = index.find(s =>
          s.dominio && s.dominio.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] === domain
        );
        if (match) slug = match.siteId;
      }
      if (!slug && index.length > 0) slug = index[0].siteId;

      if (slug) {
        const cachedConfig = await env.SITES_KV.get(`site:${slug}`, 'json');
        if (cachedConfig) {
          return jsonResponse({ ok: true, source: 'kv', config: cachedConfig });
        }
      }
    }

    // 2. Fallback: busca no Google Drive via Apps Script e sincroniza no KV
    const driveRes = await callDriveBridge(env, {
      action: 'get_config',
      site: slug,
      domain
    });

    if (driveRes.ok && driveRes.config) {
      if (env.SITES_KV && driveRes.config.siteId) {
        await env.SITES_KV.put(`site:${driveRes.config.siteId}`, JSON.stringify(driveRes.config));
      }
      return jsonResponse({ ok: true, source: 'drive', config: driveRes.config });
    }

    return jsonResponse({ ok: false, error: driveRes.error || 'Site não encontrado.' }, 404);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
}
