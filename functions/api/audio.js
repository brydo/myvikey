const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.ogg', '.aac', '.flac', '.wma'];

const contentTypeMap = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.wma': 'audio/x-ms-wma',
};

function getContentType(key) {
  const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
  return contentTypeMap[ext] || 'application/octet-stream';
}

function isAudioFile(key) {
  const lower = key.toLowerCase();
  return AUDIO_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const fileKey = url.searchParams.get('file');

  if (fileKey) {
    const safeKey = fileKey.replace(/\.\.\//g, '').replace(/^\//, '');
    const range = request.headers.get('Range');
    const options = range ? { range: parseRange(range) } : {};
    const obj = await env.AUDIO_FILES.get(safeKey, options);

    if (obj === null) {
      return new Response('Audio file not found', { status: 404 });
    }

    const headers = {
      'Content-Type': getContentType(safeKey),
      'Cache-Control': 'public, max-age=3600',
      'Accept-Ranges': 'bytes',
    };

    if (obj.size) headers['Content-Length'] = obj.size;
    if (range && obj.range) {
      headers['Content-Range'] = `bytes ${obj.range.offset}-${obj.range.end}/${obj.size}`;
    }

    return new Response(obj.body, {
      status: range && obj.range ? 206 : 200,
      headers,
    });
  }

  const files = [];
  let cursor;

  do {
    const listing = await env.AUDIO_FILES.list({ cursor, limit: 500 });
    for (const item of listing.objects) {
      if (isAudioFile(item.key)) {
        files.push({
          key: item.key,
          size: item.size,
          uploaded: item.uploaded.toISOString(),
        });
      }
    }
    cursor = listing.truncated ? listing.cursor : null;
  } while (cursor);

  files.sort((a, b) => a.key.localeCompare(b.key));

  return new Response(JSON.stringify({ success: true, files }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseRange(range) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return undefined;
  const start = match[1] ? parseInt(match[1]) : undefined;
  const end = match[2] ? parseInt(match[2]) : undefined;
  if (start !== undefined && end !== undefined) {
    return { offset: start, length: end - start + 1 };
  }
  if (start !== undefined) {
    return { offset: start };
  }
  if (end !== undefined) {
    return { offset: -end, length: end };
  }
  return undefined;
}
