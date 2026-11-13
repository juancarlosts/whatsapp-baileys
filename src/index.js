// Servicio de notificaciones por WhatsApp (solo envío).
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } from 'baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

const env = process.env;
const PORT = Number(env.PORT) || 8080;
const SESSION_DIR = env.SESSION_DIR || './session';
const SEND_INTERVAL_MS = Number(env.SEND_INTERVAL_MS) || 4000;
const QUEUE_MAX = Number(env.QUEUE_MAX) || 200;
const QUEUE_MAX_BYTES = (Number(env.QUEUE_MAX_MB) || 20) * 1024 * 1024;
const PER_RECIPIENT_PER_MIN = Number(env.PER_RECIPIENT_PER_MIN) || 5;
const ALERT_WEBHOOK_URL = env.ALERT_WEBHOOK_URL || '';
const BODY_LIMIT = 5 * 1024 * 1024;
const MAX_RETRIES = 2;

const sha256 = (s) => createHash('sha256').update(s).digest();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

// API_KEYS="sistema:clave,otro:clave"
const API_KEYS = (env.API_KEYS || '')
    .split(',')
    .map((p) => p.trim().split(':'))
    .filter(([name, key]) => name && key)
    .map(([name, key]) => ({ name, hash: sha256(key) }));

if (!API_KEYS.length) {
    console.error('Falta API_KEYS (formato: sistema:clave,otro:clave). El servicio no arranca sin claves.');
    process.exit(1);
}

// ---------- WhatsApp ----------

const baileysLogger = pino({ level: env.LOG_LEVEL || 'warn' });
let sock = null;
let status = 'connecting'; // connecting | qr | connected | disconnected
let qr = null;
let reconnectDelay = 3000;
let manualLogout = false;

async function connect() {
    mkdirSync(SESSION_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    sock = makeWASocket({
        auth: state,
        logger: baileysLogger,
        browser: Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        fireInitQueries: false,
        emitOwnEvents: false,
        getMessage: async () => undefined,
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (update.qr) {
            qr = update.qr;
            status = 'qr';
            log('Escanea este QR con WhatsApp (Dispositivos vinculados):');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            status = 'connected';
            qr = null;
            reconnectDelay = 3000;
            log('WhatsApp conectado');
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            const loggedOut = code === DisconnectReason.loggedOut;
            const waitingQr = status === 'qr';
            status = 'disconnected';
            qr = null;

            // 515: WhatsApp pide reiniciar justo después de escanear el QR; hay que
            // reconectar al instante o el teléfono cancela la vinculación.
            let delay = reconnectDelay;
            if (code === DisconnectReason.restartRequired) {
                delay = 0;
            } else if (loggedOut || waitingQr) {
                delay = reconnectDelay = 3000; // sin espera creciente mientras se muestra el QR
            } else {
                reconnectDelay = Math.min(reconnectDelay * 2, 60000);
            }

            if (loggedOut) {
                log('Sesión cerrada por WhatsApp. Hay que escanear el QR otra vez.');
                if (!manualLogout) alert('logged_out');
                manualLogout = false;
            } else if (delay) {
                log(`Conexión cerrada (código ${code}). Reintento en ${delay / 1000}s`);
            }

            setTimeout(() => {
                if (loggedOut) clearSession();
                connect().catch(onConnectError);
            }, delay);
        }
    });
}

// Borra el contenido (la carpeta es un volumen montado y no se puede eliminar)
function clearSession() {
    for (const file of readdirSync(SESSION_DIR)) {
        rmSync(join(SESSION_DIR, file), { recursive: true, force: true });
    }
}

function onConnectError(err) {
    log('Error al conectar:', err.message);
    setTimeout(() => connect().catch(onConnectError), reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 60000);
}

function alert(event) {
    if (!ALERT_WEBHOOK_URL) return;
    fetch(ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: 'whatsapp-notify', event, at: new Date().toISOString() }),
        signal: AbortSignal.timeout(10000),
    }).catch((err) => log('No se pudo enviar el aviso:', err.message));
}

// ---------- Cola de envío ----------

const queue = [];
let queueBytes = 0;
const recent = new Map(); // número -> marcas de tiempo del último minuto

function overRecipientLimit(number, adding) {
    const cutoff = Date.now() - 60000;
    const stamps = (recent.get(number) || []).filter((t) => t > cutoff);
    recent.set(number, stamps);
    return stamps.length + adding > PER_RECIPIENT_PER_MIN;
}

async function worker() {
    for (;;) {
        if (!queue.length || status !== 'connected') {
            await sleep(1000);
            continue;
        }

        const job = queue[0];
        try {
            await sock.sendMessage(`${job.to}@s.whatsapp.net`, job.content);
            log(`Enviado a ${job.to} (${job.from})`);
            queue.shift();
            queueBytes -= job.bytes;
        } catch (err) {
            job.tries++;
            if (job.tries > MAX_RETRIES) {
                log(`Descartado a ${job.to} (${job.from}) tras ${job.tries} intentos: ${err.message}`);
                queue.shift();
                queueBytes -= job.bytes;
            } else {
                log(`Fallo a ${job.to}, reintento ${job.tries}: ${err.message}`);
                await sleep(5000 * job.tries);
            }
        }

        // Pausa con algo de azar para no enviar a ritmo de bot
        await sleep(SEND_INTERVAL_MS * (0.75 + Math.random() * 0.5));
    }
}

// ---------- HTTP ----------

function send(res, code, body) {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(code, {
        'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    });
    res.end(data);
}

function authenticate(req) {
    const given = req.headers['x-api-key'];
    if (typeof given !== 'string' || !given) return null;
    const hash = sha256(given);
    let match = null;
    for (const k of API_KEYS) {
        if (timingSafeEqual(hash, k.hash)) match = k.name;
    }
    return match;
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > BODY_LIMIT) {
                reject(Object.assign(new Error('El cuerpo supera 5 MB'), { code: 413 }));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
                reject(Object.assign(new Error('JSON inválido'), { code: 400 }));
            }
        });
        req.on('error', reject);
    });
}

function normalizeNumber(value) {
    const digits = String(value).replace(/@s\.whatsapp\.net$/, '').replace(/[\s+\-()]/g, '');
    return /^\d{8,15}$/.test(digits) ? digits : null;
}

async function handleNotify(req, res, from) {
    const body = await readJson(req);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const doc = body.document;

    const numbers = (Array.isArray(body.to) ? body.to : [body.to]).map(normalizeNumber);
    if (!numbers.length || numbers.includes(null)) {
        return send(res, 400, { error: '"to" debe ser un número (o lista) de 8 a 15 dígitos con código de país' });
    }
    if (!text && !doc) {
        return send(res, 400, { error: 'Falta "text" o "document"' });
    }

    let content = { text };
    let bytes = 0;
    if (doc) {
        if (typeof doc.base64 !== 'string' || !doc.fileName) {
            return send(res, 400, { error: '"document" necesita "base64" y "fileName"' });
        }
        const buffer = Buffer.from(doc.base64.replace(/^data:.*?;base64,/, ''), 'base64');
        if (!buffer.length) return send(res, 400, { error: '"document.base64" no es válido' });
        bytes = buffer.length;
        content = {
            document: buffer,
            fileName: String(doc.fileName),
            mimetype: doc.mimetype || 'application/pdf',
            caption: text || undefined,
        };
    }

    if (queue.length + numbers.length > QUEUE_MAX || queueBytes + bytes * numbers.length > QUEUE_MAX_BYTES) {
        return send(res, 429, { error: 'Cola llena, intenta más tarde' });
    }
    const unique = [...new Set(numbers)];
    for (const n of unique) {
        const adding = numbers.filter((x) => x === n).length;
        if (overRecipientLimit(n, adding)) {
            return send(res, 429, { error: `Demasiados mensajes para ${n} en el último minuto` });
        }
    }

    for (const to of numbers) {
        recent.get(to).push(Date.now());
        queue.push({ to, content, bytes, from, tries: 0 });
        queueBytes += bytes;
    }
    send(res, 202, { queued: numbers.length, pending: queue.length, status });
}

async function handleLogout(res) {
    manualLogout = true;
    try {
        if (status === 'connected') await sock.logout();
        else sock?.end(new Error('logout'));
    } catch (err) {
        log('Error al cerrar sesión:', err.message);
    }
    clearSession();
    send(res, 200, { ok: true, message: 'Sesión cerrada. Nuevo QR disponible en /qr en unos segundos' });
}

const server = createServer(async (req, res) => {
    const route = `${req.method} ${req.url.split('?')[0]}`;
    try {
        if (route === 'GET /status') {
            return send(res, 200, { status, pending: queue.length });
        }

        if (!['POST /notify', 'GET /qr', 'POST /logout'].includes(route)) {
            return send(res, 404, { error: 'No encontrado' });
        }
        const from = authenticate(req);
        if (!from) return send(res, 401, { error: 'X-API-Key inválida o ausente' });

        if (route === 'POST /notify') return await handleNotify(req, res, from);
        if (route === 'POST /logout') return await handleLogout(res);

        // GET /qr
        if (status === 'connected') return send(res, 200, { status });
        if (!qr) return send(res, 404, { error: 'Aún no hay QR, intenta en unos segundos' });
        qrcode.generate(qr, { small: true }, (ascii) => send(res, 200, ascii + '\n'));
    } catch (err) {
        if (!res.headersSent) send(res, err.code >= 400 ? err.code : 500, { error: err.message });
    }
});

function shutdown() {
    log('Apagando...');
    server.close();
    try {
        sock?.end(undefined);
    } catch {}
    setTimeout(() => process.exit(0), 500);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => log(`whatsapp-notify escuchando en :${PORT} (claves: ${API_KEYS.map((k) => k.name).join(', ')})`));
connect().catch(onConnectError);
worker();
