export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const fileKey = url.searchParams.get('file');

  if (fileKey) {
    const safeKey = fileKey.replace(/\.\.\//g, '').replace(/^\//, '');
    const obj = await env.AUDIO_FILES.get(safeKey);

    if (obj === null) {
      return new Response('Audio file not found', { status: 404 });
    }

    const ext = safeKey.slice(safeKey.lastIndexOf('.')).toLowerCase();
    const types = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.aac': 'audio/aac', '.flac': 'audio/flac' };

    return new Response(obj.body, {
      headers: {
        'Content-Type': types[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  const files = [];
  let cursor;
  do {
    const listing = await env.AUDIO_FILES.list({ cursor, limit: 500 });
    for (const item of listing.objects) {
      const lower = item.key.toLowerCase();
      if (['.mp3','.wav','.m4a','.ogg','.aac','.flac'].some(e => lower.endsWith(e))) {
        files.push({ key: item.key, size: item.size, uploaded: item.uploaded.toISOString() });
      }
    }
    cursor = listing.truncated ? listing.cursor : null;
  } while (cursor);

  files.sort((a, b) => a.key.localeCompare(b.key));
  return new Response(JSON.stringify({ success: true, files }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
