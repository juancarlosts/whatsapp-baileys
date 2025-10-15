// src/menuHandler.js
// Sistema de menús interactivos para WhatsApp

// Almacena el estado de cada conversación (en memoria)
const conversationStates = new Map();

// Tiempo de espera para el menú (en milisegundos)
const MENU_TIMEOUT = 60000; // 1 minuto

// Definición de menús
const MENUS = {
    MAIN: {
        id: 'MAIN',
        title: '🤖 *Menú Principal*',
        message: 'Por favor, selecciona una opción:\n\n1️⃣ Soporte\n2️⃣ Productos\n3️⃣ Facturas\n\n_Escribe el número de tu opción_',
        options: {
            '1': { action: 'SOPORTE', nextMenu: 'SOPORTE' },
            '2': { action: 'PRODUCTOS', nextMenu: 'PRODUCTOS' },
            '3': { action: 'FACTURAS', nextMenu: 'FACTURAS' },
        },
        timeout: true
    },
    
    SOPORTE: {
        id: 'SOPORTE',
        title: '🆘 *Soporte Técnico*',
        message: '¿En qué podemos ayudarte?\n\n1️⃣ Problema técnico\n2️⃣ Consulta general\n3️⃣ Hablar con un agente\n0️⃣ Volver al menú principal\n\n_Escribe el número de tu opción_',
        options: {
            '1': { action: 'PROBLEMA_TECNICO', response: '🔧 Por favor, describe tu problema técnico y un agente te contactará pronto.' },
            '2': { action: 'CONSULTA_GENERAL', response: '💬 Por favor, escribe tu consulta y te responderemos a la brevedad.' },
            '3': { action: 'AGENTE', response: '👤 Un agente humano te contactará en breve. Tiempo estimado: 5 minutos.' },
            '0': { action: 'BACK', nextMenu: 'MAIN' },
        },
        timeout: true
    },
    
    PRODUCTOS: {
        id: 'PRODUCTOS',
        title: '🛍️ *Catálogo de Productos*',
        message: '¿Qué te interesa?\n\n1️⃣ Ver catálogo completo\n2️⃣ Productos en oferta\n3️⃣ Nuevos productos\n0️⃣ Volver al menú principal\n\n_Escribe el número de tu opción_',
        options: {
            '1': { action: 'CATALOGO', response: '📋 Aquí está nuestro catálogo: https://ejemplo.com/catalogo' },
            '2': { action: 'OFERTAS', response: '🔥 ¡Ofertas especiales! https://ejemplo.com/ofertas' },
            '3': { action: 'NUEVOS', response: '✨ Productos nuevos: https://ejemplo.com/nuevos' },
            '0': { action: 'BACK', nextMenu: 'MAIN' },
        },
        timeout: true
    },
    
    FACTURAS: {
        id: 'FACTURAS',
        title: '📄 *Facturas*',
        message: '¿Qué necesitas?\n\n1️⃣ Consultar factura\n2️⃣ Solicitar factura\n3️⃣ Reportar problema con factura\n0️⃣ Volver al menú principal\n\n_Escribe el número de tu opción_',
        options: {
            '1': { action: 'CONSULTAR_FACTURA', response: '🔍 Por favor, envía el número de tu factura.' },
            '2': { action: 'SOLICITAR_FACTURA', response: '📨 Por favor, envía tu RFC y número de pedido.' },
            '3': { action: 'PROBLEMA_FACTURA', response: '⚠️ Describe el problema con tu factura y te ayudaremos.' },
            '0': { action: 'BACK', nextMenu: 'MAIN' },
        },
        timeout: true
    },
    
    CLIENTE: {
        id: 'CLIENTE',
        title: '👤 *Bienvenido*',
        message: '¿Eres cliente?\n\n1️⃣ Sí, soy cliente\n2️⃣ No, quiero información\n\n_Escribe el número de tu opción_',
        options: {
            '1': { action: 'ES_CLIENTE', nextMenu: 'MAIN', response: '✅ ¡Bienvenido de nuevo!' },
            '2': { action: 'NO_CLIENTE', response: '👋 ¡Bienvenido! Te mostraremos nuestra información:\n\nWeb: https://ejemplo.com\nTeléfono: +123456789\nEmail: info@ejemplo.com' },
        },
        timeout: true
    }
};

// Obtener o crear estado de conversación
function getConversationState(userId) {
    if (!conversationStates.has(userId)) {
        conversationStates.set(userId, {
            currentMenu: null,
            lastInteraction: Date.now(),
            data: {}
        });
    }
    return conversationStates.get(userId);
}

// Limpiar estado de conversación
function clearConversationState(userId) {
    conversationStates.delete(userId);
}

// Iniciar menú
function startMenu(userId, menuId = 'CLIENTE') {
    const state = getConversationState(userId);
    state.currentMenu = menuId;
    state.lastInteraction = Date.now();
    
    const menu = MENUS[menuId];
    if (!menu) return null;
    
    // Configurar timeout si está habilitado
    if (menu.timeout) {
        setTimeout(() => {
            checkTimeout(userId);
        }, MENU_TIMEOUT);
    }
    
    return formatMenuMessage(menu);
}

// Formatear mensaje del menú
function formatMenuMessage(menu) {
    return `${menu.title}\n\n${menu.message}`;
}

// Procesar respuesta del usuario
function processUserResponse(userId, message) {
    const state = getConversationState(userId);
    
    // Si no hay menú activo y el usuario escribe "menu" o "menú"
    const normalizedMessage = message.toLowerCase().trim();
    if (!state.currentMenu || normalizedMessage === 'menu' || normalizedMessage === 'menú') {
        return startMenu(userId, 'MAIN');
    }
    
    // Verificar timeout
    if (Date.now() - state.lastInteraction > MENU_TIMEOUT) {
        clearConversationState(userId);
        return '⏱️ Tu tiempo para seleccionar una opción ha concluido.\n\nPor favor escribe la palabra *Menú* para regresar al Menú Principal.';
    }
    
    // Obtener menú actual
    const currentMenu = MENUS[state.currentMenu];
    if (!currentMenu) {
        return startMenu(userId, 'MAIN');
    }
    
    // Buscar opción seleccionada
    const option = currentMenu.options[message.trim()];
    
    if (!option) {
        return `❌ Opción no válida. Por favor, selecciona una opción del menú:\n\n${formatMenuMessage(currentMenu)}`;
    }
    
    // Actualizar última interacción
    state.lastInteraction = Date.now();
    
    // Procesar acción
    let response = '';
    
    // Si tiene respuesta directa
    if (option.response) {
        response = option.response;
    }
    
    // Si tiene siguiente menú
    if (option.nextMenu) {
        state.currentMenu = option.nextMenu;
        const nextMenu = MENUS[option.nextMenu];
        if (nextMenu) {
            response += (response ? '\n\n' : '') + formatMenuMessage(nextMenu);
        }
    } else {
        // Si no hay siguiente menú, limpiar estado
        clearConversationState(userId);
    }
    
    return response;
}

// Verificar timeout
function checkTimeout(userId) {
    const state = conversationStates.get(userId);
    if (state && Date.now() - state.lastInteraction > MENU_TIMEOUT) {
        clearConversationState(userId);
    }
}

// Verificar si un usuario está en un menú activo
function isInActiveMenu(userId) {
    const state = conversationStates.get(userId);
    if (!state || !state.currentMenu) return false;
    
    // Verificar si el menú está expirado
    if (Date.now() - state.lastInteraction > MENU_TIMEOUT) {
        clearConversationState(userId);
        return false;
    }
    
    return true;
}

// Obtener menú actual del usuario
function getCurrentMenu(userId) {
    const state = conversationStates.get(userId);
    if (!state || !state.currentMenu) return null;
    return MENUS[state.currentMenu];
}

// Exportar funciones
module.exports = {
    startMenu,
    processUserResponse,
    isInActiveMenu,
    getCurrentMenu,
    clearConversationState,
    MENUS
};
