let cachedToken = null;
let cachedTokenExp = 0;

function base64UrlEncode(input) {
  let bytes;
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = new Uint8Array(input);
  }
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const clean = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedTokenExp > now + 60) {
    return cachedToken;
  }

  if (!env.GDRIVE_CLIENT_EMAIL || !env.GDRIVE_PRIVATE_KEY) {
    throw new Error('Variáveis GDRIVE_CLIENT_EMAIL ou GDRIVE_PRIVATE_KEY não configuradas na Cloudflare.');
  }

  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({
    iss: env.GDRIVE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));

  const signingInput = `${header}.${payload}`;
  const keyBuffer = pemToArrayBuffer(env.GDRIVE_PRIVATE_KEY);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const jwt = `${signingInput}.${base64UrlEncode(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error('Erro OAuth2 Google Drive: ' + JSON.stringify(data));
  }

  cachedToken = data.access_token;
  cachedTokenExp = now + (data.expires_in || 3600);
  return cachedToken;
}

export async function findFile(token, name, parentId, mimeType = null) {
  let q = `name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed = false`;
  if (mimeType) q += ` and mimeType = '${mimeType}'`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&pageSize=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data.files && data.files.length > 0 ? data.files[0] : null;
}

export async function ensureFolder(token, name, parentId) {
  const existing = await findFile(token, name, parentId, 'application/vnd.google-apps.folder');
  if (existing) return existing.id;

  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Erro ao criar pasta no Drive: ' + JSON.stringify(data));
  return data.id;
}

export async function readJsonFile(token, name, parentId) {
  const file = await findFile(token, name, parentId);
  if (!file) return null;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return await res.json();
}

export async function writeJsonFile(token, name, parentId, jsonObj) {
  const existing = await findFile(token, name, parentId);
  const content = JSON.stringify(jsonObj, null, 2);

  if (existing) {
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8'
      },
      body: content
    });
    if (!res.ok) throw new Error('Erro ao atualizar JSON: ' + await res.text());
    return existing.id;
  }

  const boundary = 'webpanel_boundary_' + Date.now();
  const metadata = JSON.stringify({ name, parents: [parentId], mimeType: 'application/json' });
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Erro ao criar JSON: ' + JSON.stringify(data));
  return data.id;
}

export async function uploadBinaryFile(token, name, mimeType, arrayBuffer, parentId) {
  const boundary = 'webpanel_bin_' + Date.now();
  const metadata = JSON.stringify({ name, parents: [parentId], mimeType });

  const enc = new TextEncoder();
  const part1 = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const part2 = new Uint8Array(arrayBuffer);
  const part3 = enc.encode(`\r\n--${boundary}--`);

  const combined = new Uint8Array(part1.length + part2.length + part3.length);
  combined.set(part1, 0);
  combined.set(part2, part1.length);
  combined.set(part3, part1.length + part2.length);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: combined
  });

  const data = await res.json();
  if (!res.ok) throw new Error('Erro ao enviar imagem: ' + JSON.stringify(data));
  return data.id;
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
