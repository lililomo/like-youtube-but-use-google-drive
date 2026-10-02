#!/usr/bin/env node
// Fake Google Drive v3 untuk pengembangan & uji integrasi (BUKAN untuk produksi).
// Meniru endpoint yang dipakai aplikasi: about, files (get/list/create/patch), media (Range),
// changes (startPageToken/list), upload resumable (POST session, PUT chunk, DELETE).
//
// Pemakaian:
//   node scripts/dev/fake-drive.mjs --port 3298 --data /root/dv-qa/fakedrive [--seed /path/folder-sumber]
// Folder seed dipetakan menjadi pohon Drive dengan root bernama sesuai basename folder.
// ID root dicetak saat start & disimpan di <data>/root-id.txt.
// Kontrol uji: POST /_ctl/add?path=<file lokal>&parent=<id>&name=<nama>, POST /_ctl/trash?id=, POST /_ctl/rename?id=&name=
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, extname, join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith('--') ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), []),
);
const PORT = Number(args.port ?? 3298);
const DATA = args.data ?? '/root/dv-qa/fakedrive';
const STATE_FILE = join(DATA, 'state.json');
const BLOBS = join(DATA, 'blobs');
const SESSIONS = join(DATA, 'sessions');
mkdirSync(BLOBS, { recursive: true });
mkdirSync(SESSIONS, { recursive: true });

const FOLDER = 'application/vnd.google-apps.folder';
const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/x-m4v', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.avi': 'video/x-msvideo', '.srt': 'application/x-subrip', '.vtt': 'text/vtt', '.txt': 'text/plain', '.jpg': 'image/jpeg',
};

/** @type {{files: Record<string, any>, changes: {fileId: string, time: string}[]}} */
let state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : { files: {}, changes: [] };
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state));
const newId = () => '1' + randomBytes(24).toString('base64url').slice(0, 32);
const now = () => new Date().toISOString();
const md5File = (p) => createHash('md5').update(readFileSync(p)).digest('hex');

function touch(id) {
  state.changes.push({ fileId: id, time: now() });
  save();
}

function addFile({ name, parent, mimeType, localPath, appProperties }) {
  const id = newId();
  const f = { id, name, mimeType, parents: parent ? [parent] : [], trashed: false, createdTime: now(), modifiedTime: now(), appProperties: appProperties ?? undefined };
  if (localPath) {
    const blob = join(BLOBS, id);
    writeFileSync(blob, readFileSync(localPath));
    f.size = String(statSync(blob).size);
    f.md5Checksum = md5File(blob);
  }
  state.files[id] = f;
  touch(id);
  return f;
}

function seed(dir, parent) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const folder = addFile({ name: entry.name, parent, mimeType: FOLDER });
      seed(p, folder.id);
    } else {
      addFile({ name: entry.name, parent, mimeType: MIME[extname(entry.name).toLowerCase()] ?? 'application/octet-stream', localPath: p });
    }
  }
}

if (args.seed) {
  state = { files: {}, changes: [] };
  const root = addFile({ name: basename(args.seed), parent: null, mimeType: FOLDER });
  seed(args.seed, root.id);
  writeFileSync(join(DATA, 'root-id.txt'), root.id);
  save();
}

function send(res, status, body, headers = {}) {
  const data = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=UTF-8', ...headers });
  res.end(data);
}
const err = (res, status, reason, message) => send(res, status, { error: { code: status, message, errors: [{ reason, message }] } });

function publicFile(f) {
  const { ...rest } = f;
  return rest;
}

/** Parser q sederhana: "'ID' in parents and trashed = false [and mimeType = '...'] [and name = '...']". */
function filterByQ(q) {
  const parent = q.match(/'([^']+)' in parents/)?.[1];
  const mime = q.match(/mimeType = '([^']+)'/)?.[1];
  const name = q.match(/name = '((?:\\'|[^'])*)'/)?.[1]?.replace(/\\'/g, "'");
  const notTrashed = /trashed = false/.test(q);
  return Object.values(state.files).filter(
    (f) => (!parent || f.parents.includes(parent)) && (!mime || f.mimeType === mime) && (name === undefined || f.name === name) && (!notTrashed || !f.trashed),
  );
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

const sessions = new Map(); // id → {meta, size, received, path}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  try {
    // --- kontrol uji ---
    if (path === '/_ctl/state') return send(res, 200, state);
    if (path.startsWith('/_ctl/')) {
      const p = url.searchParams;
      if (path === '/_ctl/add') {
        const f = addFile({ name: p.get('name') ?? basename(p.get('path')), parent: p.get('parent'), mimeType: p.get('mime') ?? MIME[extname(p.get('path')).toLowerCase()] ?? 'application/octet-stream', localPath: p.get('path') });
        return send(res, 200, f);
      }
      if (path === '/_ctl/folder') return send(res, 200, addFile({ name: p.get('name'), parent: p.get('parent'), mimeType: FOLDER }));
      const f = state.files[p.get('id')];
      if (!f) return err(res, 404, 'notFound', 'not found');
      if (path === '/_ctl/trash') f.trashed = true;
      if (path === '/_ctl/rename') f.name = p.get('name');
      if (path === '/_ctl/move') f.parents = [p.get('parent')];
      f.modifiedTime = now();
      touch(f.id);
      return send(res, 200, f);
    }
    // --- sesi upload (tanpa auth, seperti URL sesi Google) ---
    const sess = path.match(/^\/upload\/session\/([A-Za-z0-9_-]+)$/);
    if (sess) {
      const s = sessions.get(sess[1]);
      if (!s) return err(res, 404, 'notFound', 'session not found');
      if (req.method === 'DELETE') {
        sessions.delete(sess[1]);
        res.writeHead(499);
        return res.end();
      }
      const cr = req.headers['content-range'];
      const body = await readBody(req);
      if (cr && /^bytes \*\/\d+$/.test(cr)) {
        // query status
      } else {
        let start = 0;
        if (cr) {
          const m = cr.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
          if (!m) return err(res, 400, 'badRange', 'bad content-range');
          start = Number(m[1]);
          if (start !== s.received) return err(res, 400, 'badRange', `expected offset ${s.received}`);
        }
        const fd = createWriteStream(s.path, { flags: 'a' });
        await new Promise((r, j) => fd.end(body, (e) => (e ? j(e) : r())));
        s.received += body.length;
      }
      if (s.received >= s.size) {
        const id = newId();
        renameSync(s.path, join(BLOBS, id));
        const f = { id, name: s.meta.name, mimeType: s.meta.mimeType ?? 'application/octet-stream', parents: s.meta.parents ?? [], trashed: false, createdTime: now(), modifiedTime: now(), appProperties: s.meta.appProperties, size: String(s.size), md5Checksum: md5File(join(BLOBS, id)) };
        state.files[id] = f;
        touch(id);
        sessions.delete(sess[1]);
        return send(res, 200, f);
      }
      res.writeHead(308, s.received > 0 ? { range: `bytes=0-${s.received - 1}` } : {});
      return res.end();
    }

    if (!/^Bearer .+/.test(req.headers.authorization ?? '')) return err(res, 401, 'authError', 'Invalid Credentials');

    if (path === '/drive/v3/about') return send(res, 200, { user: { emailAddress: 'fake-drive@example.com', displayName: 'Fake Drive' } });

    if (path === '/drive/v3/changes/startPageToken') return send(res, 200, { startPageToken: String(state.changes.length + 1) });
    if (path === '/drive/v3/changes') {
      const token = Number(url.searchParams.get('pageToken'));
      if (!Number.isFinite(token) || token < 1) return err(res, 400, 'invalid', 'Invalid pageToken');
      const size = Number(url.searchParams.get('pageSize') ?? 100);
      const slice = state.changes.slice(token - 1, token - 1 + size);
      const changes = slice.map((c) => ({ fileId: c.fileId, removed: !state.files[c.fileId], file: state.files[c.fileId] ? publicFile(state.files[c.fileId]) : undefined, time: c.time }));
      const next = token - 1 + slice.length;
      return send(res, 200, next < state.changes.length ? { changes, nextPageToken: String(next + 1) } : { changes, newStartPageToken: String(state.changes.length + 1) });
    }

    if (path === '/upload/drive/v3/files' && req.method === 'POST') {
      const meta = JSON.parse((await readBody(req)).toString() || '{}');
      const id = randomBytes(12).toString('base64url');
      sessions.set(id, { meta, size: Number(req.headers['x-upload-content-length'] ?? 0), received: 0, path: join(SESSIONS, id) });
      res.writeHead(200, { location: `http://127.0.0.1:${PORT}/upload/session/${id}` });
      return res.end();
    }

    if (path === '/drive/v3/files' && req.method === 'GET') {
      const files = filterByQ(url.searchParams.get('q') ?? '');
      const size = Number(url.searchParams.get('pageSize') ?? 100);
      const offset = Number(url.searchParams.get('pageToken') ?? 0);
      const page = files.slice(offset, offset + size).map(publicFile);
      return send(res, 200, offset + size < files.length ? { files: page, nextPageToken: String(offset + size) } : { files: page });
    }
    if (path === '/drive/v3/files' && req.method === 'POST') {
      const meta = JSON.parse((await readBody(req)).toString() || '{}');
      return send(res, 200, addFile({ name: meta.name, parent: meta.parents?.[0] ?? null, mimeType: meta.mimeType, appProperties: meta.appProperties }));
    }

    const fm = path.match(/^\/drive\/v3\/files\/([A-Za-z0-9_-]+)$/);
    if (fm) {
      const f = state.files[fm[1]];
      if (!f) return err(res, 404, 'notFound', `File not found: ${fm[1]}.`);
      if (req.method === 'PATCH') {
        const patch = JSON.parse((await readBody(req)).toString() || '{}');
        if (patch.name !== undefined) f.name = patch.name;
        if (patch.trashed !== undefined) f.trashed = patch.trashed;
        if (patch.appProperties) {
          f.appProperties = { ...(f.appProperties ?? {}) };
          for (const [k, v] of Object.entries(patch.appProperties)) v === null ? delete f.appProperties[k] : (f.appProperties[k] = v);
        }
        const add = url.searchParams.get('addParents');
        const remove = url.searchParams.get('removeParents');
        if (remove) f.parents = f.parents.filter((p) => p !== remove);
        if (add) f.parents.push(add);
        f.modifiedTime = now();
        touch(f.id);
        return send(res, 200, publicFile(f));
      }
      if (url.searchParams.get('alt') !== 'media') {
        return send(res, 200, { ...publicFile(f), capabilities: { canAddChildren: f.mimeType === FOLDER, canListChildren: f.mimeType === FOLDER } });
      }
      const blob = join(BLOBS, f.id);
      if (!existsSync(blob)) return err(res, 403, 'fileNotDownloadable', 'Only files with binary content can be downloaded.');
      const total = statSync(blob).size;
      const range = req.headers.range;
      const base = { 'content-type': f.mimeType, 'accept-ranges': 'bytes', etag: `"${f.md5Checksum}"`, 'last-modified': new Date(f.modifiedTime).toUTCString() };
      if (range) {
        const m = range.match(/^bytes=(\d*)-(\d*)$/);
        let start = m?.[1] ? Number(m[1]) : NaN;
        let end = m?.[2] ? Number(m[2]) : total - 1;
        if (m && !m[1] && m[2]) {
          start = total - Number(m[2]);
          end = total - 1;
        }
        if (!m || !(start >= 0) || start >= total) {
          res.writeHead(416, { 'content-range': `bytes */${total}` });
          return res.end();
        }
        end = Math.min(end, total - 1);
        res.writeHead(206, { ...base, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${total}` });
        return createReadStream(blob, { start, end }).pipe(res);
      }
      res.writeHead(200, { ...base, 'content-length': total });
      return createReadStream(blob).pipe(res);
    }
    return err(res, 404, 'notFound', `no route ${req.method} ${path}`);
  } catch (e) {
    console.error(e);
    return err(res, 500, 'backendError', String(e));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const root = existsSync(join(DATA, 'root-id.txt')) ? readFileSync(join(DATA, 'root-id.txt'), 'utf8') : '(belum ada seed)';
  console.log(`fake-drive di http://127.0.0.1:${PORT} — root ${root}`);
});
