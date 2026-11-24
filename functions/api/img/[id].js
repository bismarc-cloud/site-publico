export async function onRequestGet(context) {
  const { params } = context;
  const fileId = params.id;

  if (!fileId) {
    return new Response('ID ausente', { status: 400 });
  }

  try {
    const imgUrl = `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}`;
    const res = await fetch(imgUrl, { redirect: 'follow' });

    if (!res.ok) {
      return new Response('Imagem não encontrada', { status: 404 });
    }

    const contentType = res.headers.get('Content-Type') || 'image/jpeg';
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    return new Response('Erro ao carregar imagem: ' + err.message, { status: 500 });
  }
}
