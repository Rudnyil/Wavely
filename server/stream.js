import fs from 'node:fs';

/**
 * Serves a file with HTTP Range support (needed for seeking in <audio>), ETag and 304.
 * Only a single byte range is supported, which is all browsers send.
 */
export function sendFile(req, reply, file, { type, cacheControl }) {
  let stat;
  try { stat = fs.statSync(file); } catch { return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } }); }
  const size = stat.size;
  const etag = `W/"${size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  reply.header('Accept-Ranges', 'bytes').header('ETag', etag).header('Content-Type', type)
    .header('Cache-Control', cacheControl).header('Last-Modified', stat.mtime.toUTCString());

  if (req.headers['if-none-match'] === etag) return reply.code(304).send();

  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start;
    let end;
    if (m && (m[1] !== '' || m[2] !== '')) {
      if (m[1] === '') { // suffix: last N bytes
        const n = Number(m[2]);
        start = Math.max(size - n, 0);
        end = size - 1;
      } else {
        start = Number(m[1]);
        end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
      }
    }
    if (start === undefined || !(start <= end) || start >= size) {
      return reply.code(416).header('Content-Range', `bytes */${size}`).send();
    }
    return reply.code(206)
      .header('Content-Range', `bytes ${start}-${end}/${size}`)
      .header('Content-Length', end - start + 1)
      .send(fs.createReadStream(file, { start, end }));
  }
  return reply.header('Content-Length', size).send(fs.createReadStream(file));
}
