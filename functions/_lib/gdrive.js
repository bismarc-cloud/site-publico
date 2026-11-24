export async function callDriveBridge(env, payload) {
  if (!env.GDRIVE_SCRIPT_URL) {
    return { ok: false, skipped: true, error: 'GDRIVE_SCRIPT_URL não configurada.' };
  }

  const res = await fetch(env.GDRIVE_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    redirect: 'follow',
    body: JSON.stringify({
      ...payload,
      secret: env.GDRIVE_SCRIPT_SECRET || ''
    })
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'Resposta inválida do Apps Script: ' + text.slice(0, 200) };
  }
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
