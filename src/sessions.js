// Sesiones de WhatsApp: una conexión, una cola y una configuración por número.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
const DEFAULT_DAILY_LIMIT = Number(env.DEFAULT_DAILY_LIMIT) || 500;
const DEFAULT_NEW_CHATS_LIMIT = Number(env.DEFAULT_NEW_CHATS_LIMIT) || 100;
const WARMUP_BASE = Number(env.WARMUP_BASE) || 30; // mensajes/día la primera semana; se duplica cada semana
const WARMUP_WEEKS = 4;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const REPLY_WINDOW_MS = 24 * 3600 * 1000; // responder a quien escribió en este plazo no consume límites
const CHATS_MAX = 5000; // chats recordados por sesión
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: env.TIMEZONE || 'America/Guayaquil' });
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
const statePath = (id) => join(SESSION_DIR, `${id}.state.json`);
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
        cfg: { webhook: null, dailyLimit: 0, newChatsLimit: 0, warmup: true, ...cfg },
        sock: null,
        status: 'unlinked', // unlinked | connecting | qr | connected | disconnected
        qr: null,
        delay: 3000,
        timer: null,
        queue: [],
        pumping: false,
        recent: new Map(), // destino -> marcas de tiempo del último minuto
        hour: [], // marcas de tiempo de los envíos de la última hora
        // Estado que se guarda en disco (<id>.state.json)
        linkedAt: 0, // cuándo se vinculó el número; marca el calentamiento
        day: '',
        sentToday: 0,
        newToday: 0,
        chats: new Map(), // destino -> último mensaje recibido de él (0 = nunca escribió)
        saveTimer: null,
        unread: new Map(), // destino -> mensajes entrantes aún sin marcar como leídos
        awayTimer: null,
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
        loadState(s);
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
    rollDay(s);
    const lim = limits(s);
    return {
        id: s.id,
        status: s.status,
        number: s.sock?.user?.id?.split(/[:@]/)[0] ?? null,
        pending: s.queue.length,
        sentToday: s.sentToday,
        dailyLimit: lim.daily,
        hourlyLimit: lim.hourly,
        newChatsToday: s.newToday,
        newChatsLimit: lim.newChats,
        warmingUp: lim.warmingUp,
        linkedAt: s.linkedAt ? new Date(s.linkedAt).toISOString() : null,
        webhook: s.cfg.webhook,
    };
}

// ---------- Estado persistente y límites ----------

function loadState(s) {
    try {
        const st = JSON.parse(readFileSync(statePath(s.id), 'utf8'));
        s.linkedAt = st.linkedAt || 0;
        s.day = st.day || '';
        s.sentToday = st.sentToday || 0;
        s.newToday = st.newToday || 0;
        s.chats = new Map(st.chats || []);
    } catch {}
    // Sesión vinculada antes de existir este archivo: su antigüedad es la de creds.json
    if (!s.linkedAt && isLinked(s)) s.linkedAt = statSync(join(s.dir, 'creds.json')).birthtimeMs || Date.now();
}

function save(s) {
    s.saveTimer ??= setTimeout(() => flush(s), 5000);
}

function flush(s) {
    clearTimeout(s.saveTimer);
    s.saveTimer = null;
    if (s.deleted) return;
    const { linkedAt, day, sentToday, newToday } = s;
    try {
        const tmp = `${statePath(s.id)}.tmp`;
        writeFileSync(tmp, JSON.stringify({ linkedAt, day, sentToday, newToday, chats: [...s.chats] }));
        renameSync(tmp, statePath(s.id));
    } catch (err) {
        log(`[${s.id}] No se pudo guardar el estado: ${err.message}`);
    }
}

// El número se desvinculó: el siguiente empieza su calentamiento desde cero
function resetLink(s) {
    s.linkedAt = 0;
    s.chats.clear();
    s.unread.clear();
    flush(s);
}

const today = () => dayFormat.format(new Date()); // AAAA-MM-DD en la zona horaria local

function rollDay(s) {
    if (s.day === today()) return;
    s.day = today();
    s.sentToday = 0;
    s.newToday = 0;
}

function limits(s) {
    let daily = s.cfg.dailyLimit || DEFAULT_DAILY_LIMIT;
    const week = Math.floor((Date.now() - (s.linkedAt || Date.now())) / WEEK_MS);
    const warmingUp = s.cfg.warmup && week < WARMUP_WEEKS;
    if (warmingUp) daily = Math.min(daily, WARMUP_BASE * 2 ** week);
    const newChats = s.cfg.newChatsLimit
        ? Math.min(s.cfg.newChatsLimit, daily)
        : Math.min(DEFAULT_NEW_CHATS_LIMIT, Math.ceil(daily / 2));
    return { daily, hourly: Math.max(10, Math.ceil(daily / 4)), newChats, warmingUp };
}

// Anota el chat; los más antiguos se olvidan al pasar de CHATS_MAX
function remember(s, jid, inboundAt) {
    const last = Math.max(s.chats.get(jid) || 0, inboundAt || 0);
    s.chats.delete(jid);
    s.chats.set(jid, last);
    if (s.chats.size > CHATS_MAX) s.chats.delete(s.chats.keys().next().value);
}

// Crea la sesión o actualiza su configuración
export function upsert(id, patch = {}) {
    if (!ID_PATTERN.test(id)) throw new HttpError(400, 'Id inválido: usa minúsculas, números, "-" o "_" (máx. 40)');
    const cfg = {};
    if ('webhook' in patch) {
        if (patch.webhook && !/^https?:\/\//.test(patch.webhook)) throw new HttpError(400, '"webhook" debe ser una URL http(s) o null');
        cfg.webhook = patch.webhook || null;
    }
    for (const field of ['dailyLimit', 'newChatsLimit']) {
        if (!(field in patch)) continue;
        if (!Number.isInteger(patch[field]) || patch[field] < 0) throw new HttpError(400, `"${field}" debe ser un entero ≥ 0 (0 = valor por defecto)`);
        cfg[field] = patch[field];
    }
    if ('warmup' in patch) {
        if (typeof patch.warmup !== 'boolean') throw new HttpError(400, '"warmup" debe ser true o false');
        cfg.warmup = patch.warmup;
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
    clearTimeout(s.saveTimer);
    await closeSocket(s, true);
    dropQueue(s);
    rmSync(s.dir, { recursive: true, force: true });
    rmSync(cfgPath(s.id), { force: true });
    rmSync(statePath(s.id), { force: true });
    sessions.delete(s.id);
    log(`[${s.id}] Sesión eliminada`);
}

// Desvincula el número pero conserva la sesión y su configuración
export async function logout(s) {
    clearTimeout(s.timer);
    await closeSocket(s, true);
    clearDir(s.dir);
    dropQueue(s);
    resetLink(s);
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
    clearTimeout(s.awayTimer);
    if (!sock) return;
    try {
        if (unlink && s.status === 'connected') await sock.logout();
        else sock.end(undefined);
    } catch (err) {
        log(`[${s.id}] Error al cerrar: ${err.message}`);
    }
}

export function shutdown() {
    for (const s of sessions.values()) {
        flush(s);
        closeSocket(s, false);
    }
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
    sock.ev.on('messages.upsert', (m) => current() && onMessages(s, m));
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
        if (!s.linkedAt) {
            s.linkedAt = Date.now();
            save(s);
        }
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
            resetLink(s);
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

// ---------- Mensajes entrantes ----------
// Siempre se anota quién escribió (abre la ventana de respuesta de 24 h);
// el webhook y el "leído" solo aplican a las sesiones con webhook.

function onMessages(s, { messages, type }) {
    if (type !== 'notify') return;
    for (const m of messages) {
        const jid = m.key.remoteJid;
        if (m.key.fromMe || !/@(s\.whatsapp\.net|lid)$/.test(jid || '')) continue; // sin grupos ni estados
        const at = Number(m.messageTimestamp) * 1000 || Date.now();
        for (const j of [jid, m.key.remoteJidAlt]) if (j) remember(s, j, at);
        save(s);
        if (!s.cfg.webhook) continue;
        queueRead(s, jid, m.key);

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

// Marca como leído al cabo de 1–3 s, como alguien que abre el chat
function queueRead(s, jid, key) {
    s.unread.set(jid, [...(s.unread.get(jid) || []), key]);
    setTimeout(() => markRead(s, jid), 1000 + Math.random() * 2000);
}

async function markRead(s, jid) {
    const keys = s.unread.get(jid);
    if (!keys || s.status !== 'connected') return;
    s.unread.delete(jid);
    try {
        await s.sock.readMessages(keys);
    } catch (err) {
        log(`[${s.id}] No se pudo marcar como leído: ${err.message}`);
    }
}

// Antes de responder: leído, "en línea" y "escribiendo…" según el largo del texto
async function humanize(s, job) {
    const sock = s.sock;
    try {
        await markRead(s, job.jid);
        await sock.sendPresenceUpdate('available');
        await sock.sendPresenceUpdate('composing', job.jid);
        const chars = (job.content.text || job.content.caption || '').length;
        await sleep(Math.min(7000, Math.max(1200, chars * 50)) * (0.8 + Math.random() * 0.4));
    } catch (err) {
        log(`[${s.id}] No se pudo simular la escritura: ${err.message}`);
    }
    // Volver a "desconectado" para que el teléfono siga recibiendo notificaciones
    clearTimeout(s.awayTimer);
    s.awayTimer = setTimeout(() => {
        if (s.sock === sock) sock.sendPresenceUpdate('unavailable').catch(() => {});
    }, 15000);
}

// ---------- Cola de envío ----------

export function enqueue(s, jids, content, bytes, from) {
    rollDay(s);
    const now = Date.now();
    const lim = limits(s);
    const isReply = (jid) => now - (s.chats.get(jid) || 0) < REPLY_WINDOW_MS;
    const counted = jids.filter((jid) => !isReply(jid)); // las respuestas no consumen límites
    const fresh = new Set(counted.filter((jid) => !s.chats.has(jid)));
    s.hour = s.hour.filter((t) => t > now - 3600000);

    if (s.sentToday + counted.length > lim.daily) {
        throw new HttpError(429, `Límite diario de la sesión alcanzado (${lim.daily}${lim.warmingUp ? ', número en calentamiento' : ''})`);
    }
    if (s.hour.length + counted.length > lim.hourly) {
        throw new HttpError(429, `Límite por hora de la sesión alcanzado (${lim.hourly})`);
    }
    if (s.newToday + fresh.size > lim.newChats) {
        throw new HttpError(429, `Límite diario de chats nuevos alcanzado (${lim.newChats})`);
    }
    if (s.queue.length + jids.length > QUEUE_MAX || queuedBytes + bytes * jids.length > QUEUE_MAX_BYTES) {
        throw new HttpError(429, 'Cola llena, intenta más tarde');
    }

    const cutoff = now - 60000;
    for (const [jid, stamps] of s.recent) {
        const recent = stamps.filter((t) => t > cutoff);
        if (recent.length) s.recent.set(jid, recent);
        else s.recent.delete(jid);
    }
    for (const jid of new Set(jids)) {
        const adding = jids.filter((j) => j === jid).length;
        if ((s.recent.get(jid)?.length || 0) + adding > PER_RECIPIENT_PER_MIN) {
            throw new HttpError(429, `Demasiados mensajes para ${jid.split('@')[0]} en el último minuto`);
        }
    }

    for (const jid of jids) {
        const job = { jid, content, bytes, from, tries: 0, reply: isReply(jid) };
        if (job.reply) {
            // Las respuestas pasan delante de las notificaciones (sin tocar la que está en curso)
            const at = s.queue.findIndex((j, i) => i >= (s.pumping ? 1 : 0) && !j.reply);
            s.queue.splice(at < 0 ? s.queue.length : at, 0, job);
        } else {
            s.queue.push(job);
            s.hour.push(now);
        }
        s.recent.set(jid, [...(s.recent.get(jid) || []), now]);
        remember(s, jid);
        queuedBytes += bytes;
    }
    s.sentToday += counted.length;
    s.newToday += fresh.size;
    save(s);
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
                if (job.reply && !job.tries) await humanize(s, job);
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
