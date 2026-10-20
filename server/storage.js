import fs from 'node:fs';
import path from 'node:path';

const ID_RE = /^[A-Za-z0-9_-]{6,32}$/;

/** File layout under DATA_DIR: audio/<id>.mp3, covers/<id>.jpg, tmp/. Ids are validated, so no path traversal. */
export function createStorage(dataDir) {
  const dirs = { audio: path.join(dataDir, 'audio'), covers: path.join(dataDir, 'covers'), tmp: path.join(dataDir, 'tmp') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  // Leftovers of interrupted uploads.
  for (const f of fs.readdirSync(dirs.tmp)) fs.rmSync(path.join(dirs.tmp, f), { force: true, recursive: true });

  const safe = (id) => {
    if (!ID_RE.test(id)) throw new Error('invalid id');
    return id;
  };
  return {
    dirs,
    audioPath: (id) => path.join(dirs.audio, `${safe(id)}.mp3`),
    coverPath: (id) => path.join(dirs.covers, `${safe(id)}.jpg`),
    tmpPath: (name) => path.join(dirs.tmp, safe(name)),
    isValidId: (id) => ID_RE.test(String(id)),
    remove(id) {
      fs.rmSync(path.join(dirs.audio, `${safe(id)}.mp3`), { force: true });
      fs.rmSync(path.join(dirs.covers, `${safe(id)}.jpg`), { force: true });
    },
    removeCover(id) { fs.rmSync(path.join(dirs.covers, `${safe(id)}.jpg`), { force: true }); },
  };
}
