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

// 
// Importar el sistema de menús
//const menuHandler = require('./menuHandler');

// SGIA - Sistema de IA
const { queryAI } = require('./SGIA');

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

                // Extraer el contenido real del mensaje
                // A veces los mensajes vienen envueltos en viewOnceMessage, ephemeralMessage, etc.
                let actualMessage = msg.message;
                
                // Desempaquetar mensajes especiales
                if (msg.message.viewOnceMessage) {
                    actualMessage = msg.message.viewOnceMessage.message;
                }
                if (msg.message.ephemeralMessage) {
                    actualMessage = msg.message.ephemeralMessage.message;
                }
                if (msg.message.viewOnceMessageV2) {
                    actualMessage = msg.message.viewOnceMessageV2.message;
                }
                if (msg.message.documentWithCaptionMessage) {
                    actualMessage = msg.message.documentWithCaptionMessage.message;
                }

                // Ignorar mensajes del sistema/protocolo (borrar mensaje, editar, etc.)
                if (actualMessage.protocolMessage) {
                    console.log('🔇 Mensaje del sistema ignorado (protocolMessage)');
                    continue; // Saltar este mensaje
                }

                // Extraer texto o caption
                let body = '';
                let messageType = 'text';

                // Texto simple
                if (actualMessage.conversation) {
                    body = actualMessage.conversation;
                    messageType = 'text';
                }
                // Texto extendido (con formato, enlaces, respuestas, etc.)
                else if (actualMessage.extendedTextMessage?.text) {
                    body = actualMessage.extendedTextMessage.text;
                    messageType = 'text';
                }
                // Imagen
                else if (actualMessage.imageMessage) {
                    body = actualMessage.imageMessage.caption || '[Imagen recibida]';
                    messageType = 'image';
                }
                // Video
                else if (actualMessage.videoMessage) {
                    body = actualMessage.videoMessage.caption || '[Video recibido]';
                    messageType = 'video';
                }
                // Audio
                else if (actualMessage.audioMessage) {
                    const seconds = actualMessage.audioMessage.seconds || 0;
                    body = `[Audio recibido - ${seconds}s]`;
                    messageType = 'audio';
                }
                // Nota de voz (PTT - Push To Talk)
                else if (actualMessage.audioMessage?.ptt) {
                    const seconds = actualMessage.audioMessage.seconds || 0;
                    body = `[Nota de voz - ${seconds}s]`;
                    messageType = 'ptt';
                }
                // Documento
                else if (actualMessage.documentMessage) {
                    const fileName = actualMessage.documentMessage.fileName || 'sin nombre';
                    const caption = actualMessage.documentMessage.caption || '';
                    body = caption ? `${caption} [Documento: ${fileName}]` : `[Documento: ${fileName}]`;
                    messageType = 'document';
                }
                // Sticker
                else if (actualMessage.stickerMessage) {
                    body = '[Sticker recibido]';
                    messageType = 'sticker';
                }
                // Contacto
                else if (actualMessage.contactMessage) {
                    const contactName = actualMessage.contactMessage.displayName || 'Desconocido';
                    body = `[Contacto compartido: ${contactName}]`;
                    messageType = 'contact';
                }
                // Ubicación
                else if (actualMessage.locationMessage) {
                    const lat = actualMessage.locationMessage.degreesLatitude;
                    const lng = actualMessage.locationMessage.degreesLongitude;
                    body = `[Ubicación: ${lat}, ${lng}]`;
                    messageType = 'location';
                }
                // Ubicación en vivo
                else if (actualMessage.liveLocationMessage) {
                    body = '[Ubicación en vivo compartida]';
                    messageType = 'liveLocation';
                }
                // Reacción a mensaje
                else if (actualMessage.reactionMessage) {
                    const emoji = actualMessage.reactionMessage.text || '👍';
                    body = `[Reacción: ${emoji}]`;
                    messageType = 'reaction';
                }
                // Mensaje de producto/catálogo
                else if (actualMessage.productMessage) {
                    body = '[Producto compartido]';
                    messageType = 'product';
                }
                // Lista de opciones
                else if (actualMessage.listMessage) {
                    body = actualMessage.listMessage.description || '[Lista de opciones]';
                    messageType = 'list';
                }
                // Botones
                else if (actualMessage.buttonsMessage) {
                    body = actualMessage.buttonsMessage.contentText || '[Mensaje con botones]';
                    messageType = 'buttons';
                }
                // Plantilla con botones
                else if (actualMessage.templateMessage) {
                    body = '[Mensaje de plantilla]';
                    messageType = 'template';
                }
                // GIF
                else if (actualMessage.videoMessage?.gifPlayback) {
                    body = actualMessage.videoMessage.caption || '[GIF recibido]';
                    messageType = 'gif';
                }
                // Mensaje de llamada
                else if (actualMessage.call) {
                    body = '[Llamada entrante]';
                    messageType = 'call';
                }
                // Si no se reconoce el tipo
                else {
                    // Log para debug
                    console.log('⚠️  Tipo de mensaje no reconocido:', Object.keys(actualMessage));
                    body = '[Mensaje no soportado]';
                    messageType = 'unsupported';
                }

                const messageObj = {
                    id: msg.key.id,
                    from: contact,
                    body: body,
                    timestamp: msg.messageTimestamp?.toString() || Date.now().toString(),
                    type: messageType,
                    read: false // Nuevo campo para marcar si fue leído
                };

                incomingMessages.push(messageObj);
                console.log(`📩 Nuevo mensaje de ${contact} [${messageType}]: ${body}`);
                
                // Sistema de respuesta automática con IA (solo para mensajes de texto)
                if (messageType === 'text' && body && !body.startsWith('[')) {
                    try {
                        // Consultar a la IA con el mensaje del usuario
                        const aiResponse = await queryAI(body, contact);
                        
                        if (aiResponse) {
                            // Enviar la respuesta de la IA al usuario
                            await sock.sendMessage(contact, { text: aiResponse });
                            console.log(`🤖 Respuesta de IA enviada a ${contact}`);
                        }
                    } catch (aiError) {
                        console.error('⚠️  Error en sistema de IA:', aiError.message);
                        // Opcional: enviar mensaje de error al usuario
                        // await sock.sendMessage(contact, { 
                        //     text: 'Lo siento, estoy teniendo problemas técnicos. Intenta más tarde.' 
                        // });
                    }
                }
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
    const { unreadOnly } = req.query;
    
    let messages = incomingMessages;
    
    // Filtrar solo no leídos si se solicita
    if (unreadOnly === 'true') {
        messages = incomingMessages.filter(msg => !msg.read);
    }
    
    res.json({
        count: messages.length,
        total: incomingMessages.length,
        unread: incomingMessages.filter(msg => !msg.read).length,
        messages: messages
    });
});

// Endpoint para marcar mensajes como leídos
app.post('/messages/mark-read', express.json(), (req, res) => {
    const { messageIds } = req.body;
    
    if (!messageIds || !Array.isArray(messageIds)) {
        return res.status(400).json({ 
            error: 'Se requiere un array de messageIds' 
        });
    }
    
    let marked = 0;
    messageIds.forEach(id => {
        const msg = incomingMessages.find(m => m.id === id);
        if (msg && !msg.read) {
            msg.read = true;
            marked++;
        }
    });
    
    res.json({ 
        success: true, 
        marked: marked,
        message: `${marked} mensaje(s) marcado(s) como leído(s)` 
    });
});

// Endpoint para responder a un mensaje específico
app.post('/messages/reply', express.json(), async (req, res) => {
    const { messageId, message } = req.body;
    
    if (!messageId || !message) {
        return res.status(400).json({ 
            error: 'Se requiere messageId y message' 
        });
    }
    
    if (connectionStatus !== 'connected') {
        return res.status(503).json({ error: 'WhatsApp no está conectado' });
    }
    
    // Buscar el mensaje original
    const originalMsg = incomingMessages.find(m => m.id === messageId);
    if (!originalMsg) {
        return res.status(404).json({ error: 'Mensaje no encontrado' });
    }
    
    try {
        // Enviar respuesta al remitente
        await sock.sendMessage(originalMsg.from, { text: message });
        
        // Marcar como leído
        originalMsg.read = true;
        
        console.log(`✅ Respuesta enviada a ${originalMsg.from}`);
        
        res.json({ 
            success: true, 
            to: originalMsg.from,
            originalMessage: originalMsg.body,
            reply: message 
        });
        
    } catch (error) {
        console.error('Error al responder mensaje:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para limpiar mensajes leídos
app.delete('/messages/read', (req, res) => {
    const beforeCount = incomingMessages.length;
    const readMessages = incomingMessages.filter(msg => msg.read);
    
    // Eliminar mensajes leídos
    for (let i = incomingMessages.length - 1; i >= 0; i--) {
        if (incomingMessages[i].read) {
            incomingMessages.splice(i, 1);
        }
    }
    
    res.json({ 
        success: true, 
        deleted: readMessages.length,
        remaining: incomingMessages.length,
        message: `${readMessages.length} mensaje(s) leído(s) eliminado(s)` 
    });
});

// Endpoint para limpiar todos los mensajes
app.delete('/messages', (req, res) => {
    const count = incomingMessages.length;
    incomingMessages.length = 0;
    res.json({ 
        success: true, 
        deleted: count,
        message: 'Todos los mensajes eliminados' 
    });
});

// ======= ENDPOINTS DEL SISTEMA DE MENÚS =======

// Endpoint para iniciar un menú manualmente
app.post('/menu/start', express.json(), async (req, res) => {
    const { to, menuId = 'MAIN' } = req.body;
    
    if (!to) {
        return res.status(400).json({ error: 'Se requiere el campo "to"' });
    }
    
    if (connectionStatus !== 'connected') {
        return res.status(503).json({ error: 'WhatsApp no está conectado' });
    }
    
    try {
        const jid = to.endsWith('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;
        const menuMessage = menuHandler.startMenu(jid, menuId);
        
        if (!menuMessage) {
            return res.status(404).json({ error: 'Menú no encontrado' });
        }
        
        await sock.sendMessage(jid, { text: menuMessage });
        
        res.json({
            success: true,
            to: jid,
            menuId,
            message: 'Menú iniciado correctamente'
        });
    } catch (error) {
        console.error('Error al iniciar menú:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para obtener menús disponibles
app.get('/menu/list', (req, res) => {
    const menus = Object.keys(menuHandler.MENUS).map(key => {
        const menu = menuHandler.MENUS[key];
        return {
            id: menu.id,
            title: menu.title,
            options: Object.keys(menu.options).length
        };
    });
    
    res.json({
        count: menus.length,
        menus
    });
});

// Endpoint para obtener estado del menú de un usuario
app.get('/menu/status/:phoneNumber', (req, res) => {
    const { phoneNumber } = req.params;
    const jid = phoneNumber.endsWith('@s.whatsapp.net') 
        ? phoneNumber 
        : `${phoneNumber}@s.whatsapp.net`;
    
    const isActive = menuHandler.isInActiveMenu(jid);
    const currentMenu = menuHandler.getCurrentMenu(jid);
    
    res.json({
        phoneNumber,
        isActive,
        currentMenu: currentMenu ? {
            id: currentMenu.id,
            title: currentMenu.title
        } : null
    });
});

// Endpoint para limpiar estado del menú de un usuario
app.delete('/menu/clear/:phoneNumber', (req, res) => {
    const { phoneNumber } = req.params;
    const jid = phoneNumber.endsWith('@s.whatsapp.net') 
        ? phoneNumber 
        : `${phoneNumber}@s.whatsapp.net`;
    
    menuHandler.clearConversationState(jid);
    
    res.json({
        success: true,
        message: 'Estado del menú limpiado',
        phoneNumber
    });
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