export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const fileKey = url.searchParams.get('file');

  if (fileKey) {
    const safeKey = fileKey.replace(/\.\.\//g, '').replace(/^\//, '');
    const rangeHeader = request.headers.get('Range');
    const match = rangeHeader && !request.headers.has('If-Range') && /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    let range;
    if (match && (match[1] || match[2])) {
      const metadata = await env.AUDIO_FILES.head(safeKey);
      if (!metadata) return new Response('Audio file not found', { status: 404 });
      const size = metadata.size;
      const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size ||
          start > end || (!match[1] && Number(match[2]) === 0)) {
        return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
      }
      range = { offset: start, length: end - start + 1 };
    }
    const obj = await env.AUDIO_FILES.get(safeKey, range ? { range } : undefined);

    if (obj === null) {
      return new Response('Audio file not found', { status: 404 });
    }

    const ext = safeKey.slice(safeKey.lastIndexOf('.')).toLowerCase();
    const types = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.aac': 'audio/aac', '.flac': 'audio/flac' };

    const headers = {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
      'Accept-Ranges': 'bytes'
    };
    if (range) {
      headers['Content-Range'] = `bytes ${range.offset}-${range.offset + range.length - 1}/${obj.size}`;
      headers['Content-Length'] = String(range.length);
    } else {
      headers['Content-Length'] = String(obj.size);
    }
    return new Response(obj.body, { status: range ? 206 : 200, headers });
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
