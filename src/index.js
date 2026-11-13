// Servicio de notificaciones por WhatsApp con varias sesiones (un número por sesión).
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import qrcode from 'qrcode-terminal';
import * as wa from './sessions.js';

const { HttpError, log } = wa;
const PORT = Number(process.env.PORT) || 8080;
const BODY_LIMIT = 5 * 1024 * 1024;
const sha256 = (s) => createHash('sha256').update(s).digest();

// API_KEYS="nombre:clave:alcance,..."  alcance: "*" (administrador) o sesiones
// separadas por "|", con "*" final como comodín: "sistema|cliente-*"
const API_KEYS = (process.env.API_KEYS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
        const [name, key, scope] = entry.split(':');
        if (!name || !key || !scope) {
            console.error(`API_KEYS: la entrada de "${name}" debe tener el formato nombre:clave:alcance`);
            process.exit(1);
        }
        return { name, hash: sha256(key), scopes: scope.split('|'), admin: scope.split('|').includes('*') };
    });

if (!API_KEYS.length) {
    console.error('Falta API_KEYS. El servicio no arranca sin claves.');
    process.exit(1);
}

function authenticate(req) {
    const given = req.headers['x-api-key'];
    if (typeof given !== 'string' || !given) throw new HttpError(401, 'Falta el header X-API-Key');
    const hash = sha256(given);
    let match = null;
    for (const k of API_KEYS) {
        if (timingSafeEqual(hash, k.hash)) match = k;
    }
    if (!match) throw new HttpError(401, 'X-API-Key inválida');
    return match;
}

const canUse = (key, id) =>
    key.scopes.some((p) => p === '*' || p === id || (p.endsWith('*') && id.startsWith(p.slice(0, -1))));

function send(res, code, body) {
    const text = typeof body === 'string';
    res.writeHead(code, { 'Content-Type': text ? 'text/plain; charset=utf-8' : 'application/json' });
    res.end(text ? body : JSON.stringify(body));
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > BODY_LIMIT) {
                reject(new HttpError(413, 'El cuerpo supera 5 MB'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (!size) return resolve({});
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
                reject(new HttpError(400, 'JSON inválido'));
            }
        });
        req.on('error', reject);
    });
}

// Acepta un número con código de país o el "from" de un mensaje entrante
function toJid(value) {
    const raw = String(value).trim();
    if (/^\d{5,20}@lid$/.test(raw)) return raw;
    const digits = raw.replace(/@s\.whatsapp\.net$/, '').replace(/[\s+\-()]/g, '');
    return /^\d{8,15}$/.test(digits) ? `${digits}@s.whatsapp.net` : null;
}

async function notify(req, session, key) {
    const body = await readJson(req);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const doc = body.document;

    const jids = (Array.isArray(body.to) ? body.to : [body.to]).map(toJid);
    if (!jids.length || jids.includes(null)) {
        throw new HttpError(400, '"to" debe ser un número (o lista) de 8 a 15 dígitos con código de país');
    }
    if (!text && !doc) throw new HttpError(400, 'Falta "text" o "document"');

    let content = { text };
    let bytes = 0;
    if (doc) {
        if (typeof doc.base64 !== 'string' || !doc.fileName) {
            throw new HttpError(400, '"document" necesita "base64" y "fileName"');
        }
        const buffer = Buffer.from(doc.base64.replace(/^data:.*?;base64,/, ''), 'base64');
        if (!buffer.length) throw new HttpError(400, '"document.base64" no es válido');
        bytes = buffer.length;
        content = {
            document: buffer,
            fileName: String(doc.fileName),
            mimetype: doc.mimetype || 'application/pdf',
            caption: text || undefined,
        };
    }

    if (['unlinked', 'qr'].includes(session.status)) {
        throw new HttpError(409, `La sesión "${session.id}" no tiene un número vinculado`);
    }
    wa.enqueue(session, jids, content, bytes, key.name);
    return { queued: jids.length, pending: session.queue.length, status: session.status };
}

async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const [root, id, action, extra] = url.pathname.split('/').filter(Boolean);
    const method = req.method;

    if (method === 'GET' && root === 'status' && !id) {
        const all = wa.list();
        return send(res, 200, { ok: true, sessions: all.length, connected: all.filter((s) => s.status === 'connected').length });
    }
    if (root !== 'sessions' || extra) throw new HttpError(404, 'No encontrado');

    const key = authenticate(req);

    if (!id) {
        if (method !== 'GET') throw new HttpError(404, 'No encontrado');
        return send(res, 200, wa.list().filter((s) => canUse(key, s.id)).map(wa.info));
    }
    if (!canUse(key, id)) throw new HttpError(403, `Esta clave no puede usar la sesión "${id}"`);

    if (!action) {
        if (method === 'GET') return send(res, 200, wa.info(wa.get(id)));
        if (!key.admin) throw new HttpError(403, 'Solo una clave de administrador puede crear o eliminar sesiones');
        if (method === 'PUT') return send(res, 200, wa.info(wa.upsert(id, await readJson(req))));
        if (method === 'DELETE') {
            await wa.remove(wa.get(id));
            return send(res, 200, { ok: true });
        }
        throw new HttpError(404, 'No encontrado');
    }

    const session = wa.get(id);
    if (method === 'POST' && action === 'notify') return send(res, 202, await notify(req, session, key));
    if (method === 'POST' && action === 'logout') {
        await wa.logout(session);
        return send(res, 200, { ok: true, status: session.status });
    }
    if (method === 'GET' && action === 'qr') {
        const result = await wa.getQr(session);
        if (url.searchParams.get('format') !== 'text') return send(res, 200, result);
        if (!result.qr) return send(res, 200, `Estado: ${result.status}\n`);
        return qrcode.generate(result.qr, { small: true }, (ascii) => send(res, 200, ascii + '\n'));
    }
    throw new HttpError(404, 'No encontrado');
}

const server = createServer((req, res) => {
    route(req, res).catch((err) => {
        const known = err instanceof HttpError;
        if (!known) log('Error interno:', err);
        if (!res.headersSent) send(res, known ? err.code : 500, { error: known ? err.message : 'Error interno' });
    });
});

function shutdown() {
    log('Apagando...');
    server.close();
    wa.shutdown();
    setTimeout(() => process.exit(0), 500);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => log(`whatsapp-notify escuchando en :${PORT} (claves: ${API_KEYS.map((k) => k.name).join(', ')})`));
wa.loadAll();
