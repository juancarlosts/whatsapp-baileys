// src/index.js
const express = require('express');
const {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch').default;

const app = express();
const PORT = process.env.PORT || 8080;
const SESSION_DIR = process.env.SESSION_DIR || './session';

const incomingMessages = [];
const { unlinkSync, readdirSync } = require('fs');


// Asegurar que el directorio de sesión exista
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

let sock = null;
let qrCode = null;
let connectionStatus = 'disconnected';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: state,
        browser: ['Baileys API', 'Chrome', '1.0'],
        markOnlineOnConnect: true,
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCode = qr;
            console.log('QR recibido. Escanéalo con WhatsApp.');
            QRCode.generate(qr, { small: true });
        }

        if (connection === 'connecting') {
            connectionStatus = 'connecting';
            console.log('Conectando...');
        }

        if (connection === 'open') {
            connectionStatus = 'connected';
            qrCode = null;
            console.log('Conexión abierta. ¡Autenticado!');
        }

        if (connection === 'close') {
            connectionStatus = 'disconnected';
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Conexión cerrada. Reconectando:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 3000);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return; // Solo mensajes reales

        for (const msg of messages) {
            if (!msg.key.fromMe && msg.message) {
                const contact = msg.key.remoteJid; // Quién envió el mensaje

                // Extraer texto o caption
                let body = '';
                let messageType = 'text';

                if (msg.message.conversation) {
                    body = msg.message.conversation;
                } else if (msg.message.extendedTextMessage?.text) {
                    body = msg.message.extendedTextMessage.text;
                } else if (msg.message.imageMessage?.caption) {
                    body = msg.message.imageMessage.caption;
                    messageType = 'image';
                } else if (msg.message.videoMessage?.caption) {
                    body = msg.message.videoMessage.caption;
                    messageType = 'video';
                } else if (msg.message.documentMessage?.caption) {
                    body = msg.message.documentMessage.caption;
                    messageType = 'document';
                } else if (msg.message.audioMessage) {
                    body = '[Audio recibido]';
                    messageType = 'audio';
                } else if (msg.message.stickerMessage) {
                    body = '[Sticker recibido]';
                    messageType = 'sticker';
                } else if (
                    msg.message.imageMessage ||
                    msg.message.videoMessage ||
                    msg.message.documentMessage
                ) {
                    // Archivo sin caption
                    if (msg.message.imageMessage) {
                        body = '[Imagen recibida]';
                        messageType = 'image';
                    } else if (msg.message.videoMessage) {
                        body = '[Video recibido]';
                        messageType = 'video';
                    } else if (msg.message.documentMessage) {
                        body = `[Documento: ${msg.message.documentMessage.fileName || 'sin nombre'}]`;
                        messageType = 'document';
                    }
                } else {
                    body = '[Mensaje no soportado]';
                }

                const messageObj = {
                    id: msg.key.id,
                    from: contact,
                    body: body,
                    timestamp: msg.messageTimestamp?.toString() || Date.now().toString(),
                    type: messageType
                };

                incomingMessages.push(messageObj);
                console.log(`📩 Nuevo mensaje de ${contact}: ${body}`);
            }
        }
    });
}

// Endpoints de la API
app.get('/qr', (req, res) => {
    if (qrCode) {
        res.json({ qr: qrCode });
    } else if (connectionStatus === 'connected') {
        res.json({ status: 'authenticated' });
    } else {
        res.status(404).json({ error: 'No QR disponible. Intentando reconectar...' });
    }
});

app.post('/send', express.json(), async (req, res) => {
    const { to, message } = req.body;
    if (!to || !message) {
        return res.status(400).json({ error: 'Faltan parámetros: to, message' });
    }

    if (connectionStatus !== 'connected') {
        return res.status(503).json({ error: 'WhatsApp no está conectado' });
    }

    try {
        const id = to.endsWith('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;
        await sock.sendMessage(id, { text: message });
        console.log(`Mensaje enviado a ${to}`);
        res.json({ success: true, to, message });

        
    } catch (error) {
        console.error('Error al enviar mensaje:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/status', (req, res) => {
    console.log('Estado de conexión:', connectionStatus);
    res.json({ status: connectionStatus });
});


//app.use(express.json({ limit: '10mb' })); 
// Enviar todos los mensajes (texto e imagen)
app.post('/send-all', express.json({ limit: '10mb' }), async (req, res) => {
    const { to, message = '', media, mediaType = 'image' } = req.body;

    // Validación básica
    if (!to) {
        return res.status(400).json({ error: 'El campo "to" (número) es obligatorio.' });
    }
    if (!message && !media) {
        return res.status(400).json({ error: 'Debe proporcionar "message", "media", o ambos.' });
    }

    if (connectionStatus !== 'connected') {
        return res.status(503).json({ error: 'WhatsApp no está conectado.' });
    }

    // Normalizar el ID de WhatsApp
    const jid = to.endsWith('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;

    try {
        let mediaBuffer = null;
        let mediaOptions = {};

        if (media) {
            // Descargar o decodificar el archivo
            if (typeof media === 'string') {
                if (media.startsWith('http')) {
                    console.log(`📥 Descargando archivo desde: ${media}`);
                    const response = await fetch(media);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    mediaBuffer = await response.arrayBuffer(); // o .buffer() en algunos entornos
                    mediaBuffer = Buffer.from(mediaBuffer);
                } else if (media.startsWith('data:') || media.length > 100) {
                    // Asumimos que es base64
                    const base64Data = media.replace(/^data:.*?;base64,/, '');
                    mediaBuffer = Buffer.from(base64Data, 'base64');
                } else {
                    return res.status(400).json({ error: 'El campo "media" debe ser una URL válida o base64.' });
                }
            } else {
                return res.status(400).json({ error: '"media" debe ser una cadena (URL o base64).' });
            }

            // Validar tamaño (ej. máximo 15 MB)
            if (mediaBuffer.length > 15 * 1024 * 1024) {
                return res.status(400).json({ error: 'El archivo excede el límite de 15 MB.' });
            }

            // Determinar tipo de medio
            const allowedTypes = ['image', 'video', 'document', 'audio'];
            if (!allowedTypes.includes(mediaType)) {
                return res.status(400).json({
                    error: `Tipo de medio inválido. Use: ${allowedTypes.join(', ')}`,
                    allowed: allowedTypes
                });
            }

            mediaOptions = {
                [mediaType]: mediaBuffer,
                caption: mediaType === 'image' || mediaType === 'video' ? message : undefined,
                mimetype: 'application/octet-stream', // Baileys lo detecta automáticamente en muchos casos
                fileName: `archivo.${mediaType === 'image' ? 'jpg' : mediaType === 'video' ? 'mp4' : 'bin'}`
            };

            // Si es documento y hay mensaje, se puede usar como descripción (opcional)
            if (mediaType === 'document' && message) {
                mediaOptions.caption = message;
            }
        }

        // Enviar
        const sendOptions = media
            ? mediaOptions
            : { text: message };

        const result = await sock.sendMessage(jid, sendOptions);

        console.log(`✅ Mensaje enviado a ${to}:`, result.key.id);

        return res.json({
            success: true,
            to,
            type: media ? mediaType : 'text',
            messageId: result.key.id
        });

    } catch (error) {
        console.error('❌ Error al enviar mensaje:', error);
        return res.status(500).json({
            error: 'Error interno al enviar el mensaje',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Endpoint para obtener mensajes entrantes
app.get('/messages', (req, res) => {
    res.json({
        count: incomingMessages.length,
        messages: incomingMessages
    });
});

// Opcional: endpoint para limpiar
app.delete('/messages', (req, res) => {
    incomingMessages.length = 0;
    res.json({ success: true, message: 'Mensajes limpiados' });
});

// Iniciar
connectToWhatsApp().catch(console.error);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 API corriendo en http://localhost:${PORT}`);
});

// Endpoint para cerrar sesión
app.post('/logout', express.json(), async (req, res) => {
    console.log('Solicitud de cierre de sesión recibida');
    
    // Verificar si la variable de entorno está configurada
    if (!process.env.LOGOUT_SECRET) {
        return res.status(500).json({ 
            error: 'LOGOUT_SECRET no está configurado en el servidor' 
        });
    }
    
    const { secret } = req.body;
    
    // Verificar si se proporcionó el secreto
    if (!secret) {
        return res.status(400).json({ 
            error: 'Se requiere el campo "secret" en el body de la petición' 
        });
    }
    
    if (secret !== process.env.LOGOUT_SECRET) {
        return res.status(403).json({ error: 'Secreto inválido' });
    }
    try {
        // 1. Intentar cerrar conexión solo si está conectada
        if (sock && connectionStatus === 'connected') {
            try {
                await sock.logout();
                console.log('✅ Conexión cerrada correctamente en WhatsApp');
            } catch (logoutError) {
                console.log('⚠️  Conexión ya cerrada o error al notificar a WhatsApp:', logoutError.message);
            }
        }
        
        // 2. Siempre limpiar referencias y estado local
        sock = null;
        qrCode = null;
        connectionStatus = 'disconnected';
        incomingMessages.length = 0;
        console.log('🧹 Estado local limpiado');

        // 3. Limpiar archivos de sesión
        clearSessionDir();

        // 4. Reiniciar conexión para generar nuevo QR
        setTimeout(() => {
            console.log('� Iniciando nueva conexión...');
            connectToWhatsApp().catch(console.error);
        }, 2000);

        res.json({ 
            success: true, 
            message: 'Sesión cerrada y reiniciada. Nuevo QR disponible en /qr en 3-5 segundos' 
        });

    } catch (error) {
        console.error('❌ Error al cerrar sesión:', error);
        
        // Forzar limpieza aunque haya error
        sock = null;
        qrCode = null;
        connectionStatus = 'disconnected';
        incomingMessages.length = 0;
        
        try {
            clearSessionDir();
        } catch (clearError) {
            console.error('❌ Error al limpiar archivos:', clearError.message);
        }
        
        // Reintentar conexión
        setTimeout(() => {
            console.log('🔄 Reintentando conexión después del error...');
            connectToWhatsApp().catch(console.error);
        }, 2000);
        
        res.json({ 
            success: true, 
            message: 'Sesión forzada a reiniciar. Nuevo QR disponible en /qr en unos segundos' 
        });
    }
});

// Función para limpiar el directorio de sesión
function clearSessionDir() {
    const files = readdirSync(SESSION_DIR);
    for (const file of files) {
        // Evita borrar cosas raras; solo archivos de Baileys
        if (file !== '.' && file !== '..') {
            try {
                unlinkSync(path.join(SESSION_DIR, file));
                console.log(`🗑️  Eliminado: ${file}`);
            } catch (err) {
                console.warn(`⚠️  No se pudo eliminar ${file}:`, err.message);
            }
        }
    }
}