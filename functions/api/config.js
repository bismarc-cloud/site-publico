import { getAccessToken, findFile, readJsonFile, jsonResponse } from '../_lib/gdrive.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return jsonResponse({ ok: true });

  try {
    const url = new URL(request.url);
    let slug = (url.searchParams.get('site') || '').trim().toLowerCase();
    const domain = (url.searchParams.get('domain') || request.headers.get('host') || '').trim().toLowerCase();

    const token = await getAccessToken(env);
    const rootId = env.GDRIVE_ROOT_FOLDER_ID;
    const index = (await readJsonFile(token, 'sites_index.json', rootId)) || [];

    if (!slug && domain) {
      const cleanDomain = domain.replace(/^www\./, '').split(':')[0];
      const match = index.find(s =>
        s.dominio && s.dominio.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] === cleanDomain
      );
      if (match) slug = match.siteId;
    }

    if (!slug && index.length > 0) {
      slug = index[0].siteId;
    }

    if (!slug) {
      return jsonResponse({ ok: false, error: 'Nenhum site encontrado.' }, 404);
    }

    const folder = await findFile(token, slug, rootId, 'application/vnd.google-apps.folder');
    if (!folder) {
      return jsonResponse({ ok: false, error: `Site "${slug}" não encontrado no Drive.` }, 404);
    }

    const config = await readJsonFile(token, 'config.json', folder.id);
    if (!config) {
      return jsonResponse({ ok: false, error: 'Arquivo config.json não encontrado.' }, 404);
    }

    return jsonResponse({ ok: true, config });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
}
