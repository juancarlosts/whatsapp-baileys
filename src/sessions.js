// Sesiones de WhatsApp: una conexión, una cola y una configuración por número.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } from 'baileys';
import pino from 'pino';

const env = process.env;
const SESSION_DIR = env.SESSION_DIR || './session';
const MAX_SESSIONS = Number(env.MAX_SESSIONS) || 10;
const SEND_INTERVAL_MS = Number(env.SEND_INTERVAL_MS) || 4000;
const QUEUE_MAX = Number(env.QUEUE_MAX) || 200;
const QUEUE_MAX_BYTES = (Number(env.QUEUE_MAX_MB) || 20) * 1024 * 1024;
const PER_RECIPIENT_PER_MIN = Number(env.PER_RECIPIENT_PER_MIN) || 5;
const ALERT_WEBHOOK_URL = env.ALERT_WEBHOOK_URL || '';
const WEBHOOK_TOKEN = env.WEBHOOK_TOKEN || '';
const MAX_RETRIES = 2;
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

// libsignal vuelca sesiones completas (con claves) por console.info/warn: se silencian
console.info = console.warn = () => {};

const baileysLogger = pino({ level: env.LOG_LEVEL || 'warn' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = (...a) => console.log(new Date().toISOString(), ...a);

export class HttpError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

const sessions = new Map();
let queuedBytes = 0; // total en todas las colas

const cfgPath = (id) => join(SESSION_DIR, `${id}.json`);
const isLinked = (s) => existsSync(join(s.dir, 'creds.json'));

function clearDir(dir) {
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir)) rmSync(join(dir, file), { recursive: true, force: true });
}

function post(url, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (WEBHOOK_TOKEN) headers['X-Webhook-Token'] = WEBHOOK_TOKEN;
    fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) })
        .catch((err) => log(`[${body.session}] Webhook falló: ${err.message}`));
}

// ---------- Alta, baja y consulta ----------

function create(id, cfg) {
    const s = {
        id,
        dir: join(SESSION_DIR, id),
        cfg: { webhook: null, dailyLimit: 0, ...cfg },
        sock: null,
        status: 'unlinked', // unlinked | connecting | qr | connected | disconnected
        qr: null,
        delay: 3000,
        timer: null,
        queue: [],
        pumping: false,
        recent: new Map(), // destino -> marcas de tiempo del último minuto
        day: '',
        sentToday: 0,
        manualLogout: false,
        deleted: false,
    };
    sessions.set(id, s);
    return s;
}

export function loadAll() {
    mkdirSync(SESSION_DIR, { recursive: true });
    for (const id of readdirSync(SESSION_DIR)) {
        if (!ID_PATTERN.test(id) || !statSync(join(SESSION_DIR, id)).isDirectory()) continue;
        let cfg = {};
        try {
            cfg = JSON.parse(readFileSync(cfgPath(id), 'utf8'));
        } catch {}
        const s = create(id, cfg);
        if (isLinked(s)) connect(s).catch((err) => retry(s, err));
    }
    log(`Sesiones cargadas: ${[...sessions.keys()].join(', ') || 'ninguna'}`);
}

export function get(id) {
    const s = sessions.get(id);
    if (!s) throw new HttpError(404, `La sesión "${id}" no existe`);
    return s;
}

export const list = () => [...sessions.values()];

export function info(s) {
    return {
        id: s.id,
        status: s.status,
        number: s.sock?.user?.id?.split(/[:@]/)[0] ?? null,
        pending: s.queue.length,
        sentToday: s.day === today() ? s.sentToday : 0,
        dailyLimit: s.cfg.dailyLimit,
        webhook: s.cfg.webhook,
    };
}

// Crea la sesión o actualiza su configuración
export function upsert(id, patch = {}) {
    if (!ID_PATTERN.test(id)) throw new HttpError(400, 'Id inválido: usa minúsculas, números, "-" o "_" (máx. 40)');
    const cfg = {};
    if ('webhook' in patch) {
        if (patch.webhook && !/^https?:\/\//.test(patch.webhook)) throw new HttpError(400, '"webhook" debe ser una URL http(s) o null');
        cfg.webhook = patch.webhook || null;
    }
    if ('dailyLimit' in patch) {
        if (!Number.isInteger(patch.dailyLimit) || patch.dailyLimit < 0) throw new HttpError(400, '"dailyLimit" debe ser un entero ≥ 0 (0 = sin límite)');
        cfg.dailyLimit = patch.dailyLimit;
    }

    let s = sessions.get(id);
    if (!s) {
        if (sessions.size >= MAX_SESSIONS) throw new HttpError(409, `Se alcanzó el máximo de ${MAX_SESSIONS} sesiones`);
        s = create(id, {});
        mkdirSync(s.dir, { recursive: true });
    }
    Object.assign(s.cfg, cfg);
    writeFileSync(cfgPath(id), JSON.stringify(s.cfg));
    return s;
}

export async function remove(s) {
    s.deleted = true;
    clearTimeout(s.timer);
    await closeSocket(s, true);
    dropQueue(s);
    rmSync(s.dir, { recursive: true, force: true });
    rmSync(cfgPath(s.id), { force: true });
    sessions.delete(s.id);
    log(`[${s.id}] Sesión eliminada`);
}

// Desvincula el número pero conserva la sesión y su configuración
export async function logout(s) {
    clearTimeout(s.timer);
    await closeSocket(s, true);
    clearDir(s.dir);
    dropQueue(s);
    s.status = 'unlinked';
    log(`[${s.id}] Sesión desvinculada`);
}

function dropQueue(s) {
    for (const job of s.queue) queuedBytes -= job.bytes;
    s.queue.length = 0;
}

async function closeSocket(s, unlink) {
    const sock = s.sock;
    s.sock = null; // los eventos de este socket se ignoran a partir de aquí
    s.qr = null;
    if (!sock) return;
    try {
        if (unlink && s.status === 'connected') await sock.logout();
        else sock.end(undefined);
    } catch (err) {
        log(`[${s.id}] Error al cerrar: ${err.message}`);
    }
}

export function shutdown() {
    for (const s of sessions.values()) closeSocket(s, false);
}

// ---------- Conexión ----------

async function connect(s) {
    clearTimeout(s.timer);
    if (!isLinked(s)) clearDir(s.dir); // restos de una vinculación anterior
    mkdirSync(s.dir, { recursive: true });
    s.status = 'connecting';
    const { state, saveCreds } = await useMultiFileAuthState(s.dir);
    if (s.deleted) return;

    const sock = makeWASocket({
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
    s.sock = sock;
    const current = () => s.sock === sock;

    sock.ev.on('creds.update', () => current() && saveCreds());
    sock.ev.on('messages.upsert', (m) => current() && s.cfg.webhook && onMessages(s, m));
    sock.ev.on('connection.update', (u) => current() && onConnection(s, u));
}

function onConnection(s, { connection, lastDisconnect, qr }) {
    if (qr) {
        s.qr = qr;
        s.status = 'qr';
    }

    if (connection === 'open') {
        s.status = 'connected';
        s.qr = null;
        s.delay = 3000;
        log(`[${s.id}] Conectado`);
        pump(s);
    }

    if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const waitingQr = s.status === 'qr';
        s.sock = null;
        s.qr = null;

        if (code === DisconnectReason.loggedOut) {
            clearDir(s.dir);
            dropQueue(s);
            s.status = 'unlinked';
            log(`[${s.id}] WhatsApp cerró la sesión; hay que volver a escanear el QR`);
            if (ALERT_WEBHOOK_URL) post(ALERT_WEBHOOK_URL, { session: s.id, event: 'logged_out', at: new Date().toISOString() });
        } else if (code === DisconnectReason.restartRequired) {
            // Llega justo después de escanear el QR: hay que reconectar al instante
            // o el teléfono cancela la vinculación.
            connect(s).catch((err) => retry(s, err));
        } else if (waitingQr) {
            s.status = 'unlinked'; // el QR caducó sin escanear; se genera otro al pedirlo
        } else {
            retry(s, new Error(`código ${code}`));
        }
    }
}

function retry(s, err) {
    if (s.deleted) return;
    if (!isLinked(s)) {
        s.status = 'unlinked';
        return;
    }
    s.status = 'disconnected';
    log(`[${s.id}] Conexión caída (${err.message}). Reintento en ${s.delay / 1000}s`);
    s.timer = setTimeout(() => connect(s).catch((e) => retry(s, e)), s.delay);
    s.delay = Math.min(s.delay * 2, 60000);
}

// Devuelve el QR; si la sesión está sin vincular, abre la conexión para generarlo
export async function getQr(s) {
    if (s.status === 'unlinked') await connect(s);
    for (let i = 0; i < 40 && !s.qr && s.status !== 'connected' && s.status !== 'unlinked'; i++) await sleep(250);
    return { status: s.status, qr: s.qr };
}

// ---------- Mensajes entrantes (solo sesiones con webhook) ----------

function onMessages(s, { messages, type }) {
    if (type !== 'notify') return;
    for (const m of messages) {
        const jid = m.key.remoteJid;
        if (m.key.fromMe || !/@(s\.whatsapp\.net|lid)$/.test(jid || '')) continue; // sin grupos ni estados
        const msg = m.message;
        const text = msg?.conversation || msg?.extendedTextMessage?.text || msg?.imageMessage?.caption;
        if (!text) continue;

        const phoneJid = [jid, m.key.remoteJidAlt].find((j) => j?.endsWith('@s.whatsapp.net'));
        post(s.cfg.webhook, {
            session: s.id,
            from: jid, // úsalo tal cual en "to" para responder
            number: phoneJid ? phoneJid.split(/[:@]/)[0] : null,
            name: m.pushName || null,
            text,
            id: m.key.id,
            timestamp: Number(m.messageTimestamp),
        });
    }
}

// ---------- Cola de envío ----------

const today = () => new Date().toISOString().slice(0, 10);

export function enqueue(s, jids, content, bytes, from) {
    if (s.day !== today()) {
        s.day = today();
        s.sentToday = 0;
    }
    if (s.cfg.dailyLimit && s.sentToday + jids.length > s.cfg.dailyLimit) {
        throw new HttpError(429, `Límite diario de la sesión alcanzado (${s.cfg.dailyLimit})`);
    }
    if (s.queue.length + jids.length > QUEUE_MAX || queuedBytes + bytes * jids.length > QUEUE_MAX_BYTES) {
        throw new HttpError(429, 'Cola llena, intenta más tarde');
    }

    const cutoff = Date.now() - 60000;
    for (const [jid, stamps] of s.recent) {
        const fresh = stamps.filter((t) => t > cutoff);
        if (fresh.length) s.recent.set(jid, fresh);
        else s.recent.delete(jid);
    }
    for (const jid of new Set(jids)) {
        const adding = jids.filter((j) => j === jid).length;
        if ((s.recent.get(jid)?.length || 0) + adding > PER_RECIPIENT_PER_MIN) {
            throw new HttpError(429, `Demasiados mensajes para ${jid.split('@')[0]} en el último minuto`);
        }
    }

    for (const jid of jids) {
        s.recent.set(jid, [...(s.recent.get(jid) || []), Date.now()]);
        s.queue.push({ jid, content, bytes, from, tries: 0 });
        queuedBytes += bytes;
    }
    s.sentToday += jids.length;
    pump(s);
}

async function pump(s) {
    if (s.pumping) return;
    s.pumping = true;
    const done = () => {
        queuedBytes -= s.queue.shift().bytes;
    };
    try {
        while (s.queue.length && s.status === 'connected' && !s.deleted) {
            const job = s.queue[0];
            const to = job.jid.split('@')[0];
            try {
                await s.sock.sendMessage(job.jid, job.content);
                log(`[${s.id}] Enviado a ${to} (${job.from})`);
                done();
            } catch (err) {
                if (s.status !== 'connected') break; // se cayó la conexión: se reintenta al volver
                if (++job.tries > MAX_RETRIES) {
                    log(`[${s.id}] Descartado a ${to} (${job.from}) tras ${job.tries} intentos: ${err.message}`);
                    done();
                } else {
                    log(`[${s.id}] Fallo a ${to}, reintento ${job.tries}: ${err.message}`);
                    await sleep(5000 * job.tries);
                    continue;
                }
            }
            // Pausa con algo de azar para no enviar a ritmo de bot
            await sleep(SEND_INTERVAL_MS * (0.75 + Math.random() * 0.5));
        }
    } finally {
        s.pumping = false;
    }
}
