// src/menuHandlerPersona.js
// Sistema de menús para búsqueda de personas con integración a APIs externas

const fetch = require('node-fetch').default;
require('dotenv').config();

// Almacena el estado de cada conversación (en memoria)
const conversationStates = new Map();

// Tiempo de espera para el menú (en milisegundos)
const MENU_TIMEOUT = 120000; // 2 minutos (más tiempo para búsquedas)

// Estados de conversación
const STATES = {
    IDLE: 'IDLE',
    MENU_PRINCIPAL: 'MENU_PRINCIPAL',
    ESPERANDO_NOMBRE: 'ESPERANDO_NOMBRE',
    ESPERANDO_CEDULA: 'ESPERANDO_CEDULA',
    ESPERANDO_PLACA: 'ESPERANDO_PLACA',
    MOSTRANDO_RESULTADOS: 'MOSTRANDO_RESULTADOS'
};

// Array de títulos aleatorios para el menú
const titulosMenu = [
    '👤 *Búsqueda de Personas*',
    '🔎 *Consulta de Datos Personales*',
    '👥 *Consulta de Ciudadanos*',
    '👤 *Información del Ciudadano*',
    '🧾 *Verificación de Identidad*',
    '📋 *Revisión de Datos Registrales*',
    '🕵️‍♂️ *Localizador de Personas*',
    '📘 *Consulta de Información Civil*',
    '📇 *Consulta del Registro de Personas*',
    '💼 *Información Identificativa*',
    '🗂️ *Datos del Ciudadano*',
    '🧍‍♂️ *Información Personal Encontrada*',
    '📁 *Detalles del Registro Ciudadano*',
    '🔍 *Identificación y Verificación*',
    '🧭 *Localización de Datos Personales*',
    '🪪 *Consulta del Documento de Identidad*',
    '👫 *Información de Personas Registradas*',
    '📑 *Verificación de Datos Civiles*',
    '🗃️ *Consulta del Archivo Ciudadano*'
];

// Función para obtener un título aleatorio
function getTituloAleatorio() {
    return titulosMenu[Math.floor(Math.random() * titulosMenu.length)];
}

// Definición de menús
const MENUS = {
    PRINCIPAL: {
        id: 'PRINCIPAL',
        title: getTituloAleatorio(),
        message: 'Bienvenido al sistema de búsqueda.\n\n¿Cómo deseas buscar?\n\n1️⃣ Buscar por Nombre\n2️⃣ Buscar por Cédula\n3️⃣ Buscar por Placa\n0️⃣ Salir\n\n_Escribe el número de tu opción_',
        state: STATES.MENU_PRINCIPAL
    }
};

// Obtener o crear estado de conversación
function getConversationState(userId) {
    if (!conversationStates.has(userId)) {
        conversationStates.set(userId, {
            state: STATES.IDLE,
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
function startMenu(userId, menuId = 'PRINCIPAL') {
    const state = getConversationState(userId);
    state.state = STATES.MENU_PRINCIPAL;
    state.lastInteraction = Date.now();
    state.data = {};
    
    const menu = MENUS[menuId];
    if (!menu) return null;
    
    // Asignar un título aleatorio cada vez que se inicia el menú
    menu.title = getTituloAleatorio();
    
    // Configurar timeout
    setTimeout(() => {
        checkTimeout(userId);
    }, MENU_TIMEOUT);
    
    return formatMenuMessage(menu, userId);
}

// Formatear mensaje del menú
function formatMenuMessage(menu, userId = null) {
    let mensaje = `${menu.title}\n\n`;
    
    // Agregar saludo personalizado si hay userId
    if (userId) {
        // Extraer el número de teléfono (eliminar @s.whatsapp.net)
        const phoneNumber = userId.replace('@s.whatsapp.net', '');
        
        // Array de mensajes de bienvenida aleatorios
        const saludos = [
            `Bienvenido *${phoneNumber}* al sistema de búsqueda.\n\n`,
            `Bienvenido al sistema de búsqueda usuario *${phoneNumber}*.\n\n`,
            `Bienvenido *${phoneNumber}*, al sistema de búsqueda.\n\n`,
            `Hola *${phoneNumber}*, bienvenido al sistema de búsqueda.\n\n`,
            `¡Saludos *${phoneNumber}*! Bienvenido al sistema de búsqueda.\n\n`,
            `Sistema de búsqueda activado para *${phoneNumber}*.\n\n`
        ];
        
        // Seleccionar un saludo aleatorio
        const saludoAleatorio = saludos[Math.floor(Math.random() * saludos.length)];
        mensaje += saludoAleatorio;
    } else {
        mensaje += `Bienvenido al sistema de búsqueda.\n\n`;
    }
    
    // Agregar el resto del mensaje del menú (sin el "Bienvenido..." original)
    const mensajeOriginal = menu.message.replace('Bienvenido al sistema de búsqueda.\n\n', '');
    mensaje += mensajeOriginal;
    
    return mensaje;
}

// Función unificada para realizar búsquedas en API N8N
async function buscarEnAPI(type, query) {
    try {
        const baseUrl = process.env.URL_API_N8N;
        const token = process.env.AUTHORIZATION_N8N || '';
        
        if (!baseUrl) {
            console.error('❌ URL_API_N8N no está configurada en el archivo .env');
            return { success: false, error: 'URL_API_N8N no configurada' };
        }
        
        // Construir URL con parámetros
        const url = `${baseUrl}?type=${encodeURIComponent(type)}&query=${encodeURIComponent(query)}`;
        
        console.log(`🔍 Búsqueda [${type}]: ${query}`);
        console.log(`📡 URL: ${url}`);
        console.log(`🔑 Token presente: ${token ? 'Sí' : 'No'}`);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'persondata': token
            }
        });

        console.log(`📡 Status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Error HTTP: ${response.status} ${response.statusText}`);
            console.error(`📄 Respuesta: ${errorText.substring(0, 500)}`);
            return { success: false, error: `Error HTTP: ${response.status}` };
        }

        const data = await response.json();
        console.log('✅ Respuesta API:', JSON.stringify(data).substring(0, 200));
        
        return { success: true, data };
    } catch (error) {
        console.error(`❌ Error en búsqueda [${type}]:`, error);
        return { success: false, error: error.message };
    }
}

// Función para buscar por cédula
async function buscarPorCedula(cedula) {
    return await buscarEnAPI('cedula', cedula);
}

// Función para buscar por nombre
async function buscarPorNombre(nombre) {
    return await buscarEnAPI('nombres', nombre);
}

// Función para buscar por placa
async function buscarPorPlaca(placa) {
    return await buscarEnAPI('placa', placa);
}

// Formatear resultados de búsqueda por cédula
function formatResultadoCedula(data) {
    if (!data || typeof data !== 'object') {
        return { mensaje: '❌ No se encontraron resultados para esta cédula.', photo: null };
    }

    // Si la API devuelve los datos ya formateados en data.data, data.mensaje o data.formattedOutput
    const textoRespuesta = data.data || data.mensaje || data.formattedOutput;
    if (textoRespuesta && typeof textoRespuesta === 'string') {
        // Extraer URL de foto si existe en el texto
        let photoUrl = null;
        const photoMatch = textoRespuesta.match(/(?:🖼️\s*Foto:|Foto:)\s*(https?:\/\/[^\s\n]+)/i);
        if (photoMatch) {
            photoUrl = photoMatch[1];
            console.log(`📸 URL de foto extraída: ${photoUrl}`);
        }
        
        // Eliminar la línea de la foto del mensaje
        let mensajeLimpio = textoRespuesta.replace(/(?:🖼️\s*Foto:|Foto:)\s*https?:\/\/[^\s\n]+\s*/gi, '');
        
        return { 
            mensaje: '✅ *Resultado de la búsqueda*\n\n' + mensajeLimpio + '\n\n_Escribe "menu" para volver al menú principal_', 
            photo: photoUrl 
        };
    }

    // Si no hay datos pre-formateados, retornar error
    return { mensaje: '❌ No se encontró información para esta cédula.', photo: null };
}

// Formatear resultados de búsqueda por nombre
function formatResultadoNombre(data) {
    if (!data) {
        return '❌ No se encontraron resultados para este nombre.';
    }

    // Si la API devuelve los datos ya formateados en data.data, data.mensaje o data.formattedOutput
    const mensaje = data.data || data.mensaje || data.formattedOutput;
    if (mensaje && typeof mensaje === 'string') {
        return '✅ *Resultados de la búsqueda*\n\n' + mensaje + '\n\n_Escribe "menu" para volver al menú principal_';
    }

    // Si no hay datos pre-formateados, retornar error
    return '❌ No se encontraron personas con ese nombre.';
}

// Formatear resultados de búsqueda por placa
function formatResultadoPlaca(data) {
    if (!data || typeof data !== 'object') {
        return '❌ No se encontraron resultados para esta placa.';
    }

    // Si la API devuelve los datos ya formateados en data.data, data.mensaje o data.formattedOutput
    const mensaje = data.data || data.mensaje || data.formattedOutput;
    if (mensaje && typeof mensaje === 'string') {
        return '✅ *Resultado de la búsqueda de placa*\n\n' + mensaje + '\n\n_Escribe "menu" para volver al menú principal_';
    }

    // Si no hay datos pre-formateados, retornar error
    return '❌ No se encontró información para esta placa.';
}

// Validar formato de cédula ecuatoriana
function validarCedula(cedula) {
    // Eliminar espacios y guiones
    cedula = cedula.replace(/[\s-]/g, '');
    
    // Debe tener exactamente 10 dígitos
    if (!/^\d{10}$/.test(cedula)) {
        return false;
    }
    
    return true;
}

// Validar formato de placa ecuatoriana
function validarPlaca(placa) {
    // Eliminar espacios y convertir a mayúsculas
    placa = placa.replace(/\s/g, '').toUpperCase();
    
    // Formatos válidos en Ecuador:
    // ABC-1234 o ABC1234 (vehículos particulares)
    // ABC-123 o ABC123 (motos formato nuevo)
    // AB123C (motos formato antiguo: 2 letras + 3 números + 1 letra)
    const formatoParticular = /^[A-Z]{3}-?\d{4}$/;
    const formatoMotoNuevo = /^[A-Z]{3}-?\d{3}$/;
    const formatoMotoAntiguo = /^[A-Z]{2}\d{3}[A-Z]$/;
    
    return formatoParticular.test(placa) || formatoMotoNuevo.test(placa) || formatoMotoAntiguo.test(placa);
}

// Procesar respuesta del usuario
async function processUserResponse(userId, message) {
    const state = getConversationState(userId);
    const normalizedMessage = message.trim();
    
    // Comando especial para iniciar o volver al menú
    if (normalizedMessage.toLowerCase() === 'menu' || normalizedMessage.toLowerCase() === 'menú') {
        return startMenu(userId);
    }
    
    // Comando especial para salir
    if (normalizedMessage === '0' || normalizedMessage.toLowerCase() === 'salir') {
        clearConversationState(userId);
        return '👋 Has salido del sistema de búsqueda.\n\n_Escribe "menu" cuando quieras volver._';
    }
    
    // Verificar timeout
    if (Date.now() - state.lastInteraction > MENU_TIMEOUT) {
        clearConversationState(userId);
        return '⏱️ Tu sesión ha expirado por inactividad.\n\n_Escribe "menu" para iniciar una nueva búsqueda._';
    }
    
    // Actualizar última interacción
    state.lastInteraction = Date.now();
    
    // Máquina de estados
    switch (state.state) {
        case STATES.IDLE:
            // Si está inactivo, iniciar menú
            return startMenu(userId);
            
        case STATES.MENU_PRINCIPAL:
            if (normalizedMessage === '1') {
                // Búsqueda por nombre
                state.state = STATES.ESPERANDO_NOMBRE;
                return '👤 *Búsqueda por Nombre*\n\n📝 Por favor, escribe primero los APELLIDOS y luego los NOMBRES de la persona que deseas buscar (mínimo 2 palabras):\n\n_Ejemplo: Lopez Leon Pepito Andres o Pérez Juan_';
            } else if (normalizedMessage === '2') {
                // Búsqueda por cédula
                state.state = STATES.ESPERANDO_CEDULA;
                return '🆔 *Búsqueda por Cédula*\n\n📝 Por favor, escribe el número de cédula (10 dígitos):\n\n_Ejemplo: 1234567890_';
            } else if (normalizedMessage === '3') {
                // Búsqueda por placa
                state.state = STATES.ESPERANDO_PLACA;
                return '🚗 *Búsqueda por Placa*\n\n📝 Por favor, escribe el número de placa del vehículo:\n\n_Ejemplo: AAA1234_';
            } else {
                return '❌ Opción no válida.\n\n' + formatMenuMessage(MENUS.PRINCIPAL);
            }
            
        case STATES.ESPERANDO_NOMBRE:
            if (normalizedMessage.length < 3) {
                return '⚠️ El nombre debe tener al menos 3 caracteres.\n\n📝 Intenta nuevamente:';
            }
            
            // Validar que tenga al menos 2 palabras (apellido y nombre)
            const palabras = normalizedMessage.trim().split(/\s+/);
            if (palabras.length < 2) {
                return '⚠️ Debes ingresar al menos 2 palabras (apellidos y nombres).\n\n_Ejemplo: Lopez Leon Pepito Andres o Pérez Juan_\n\n📝 Intenta nuevamente:';
            }
            
            // Realizar búsqueda por nombre
            state.state = STATES.MOSTRANDO_RESULTADOS;
            const resultadoNombre = await buscarPorNombre(normalizedMessage);
            
            if (resultadoNombre.success) {
                clearConversationState(userId); // Limpiar después de mostrar resultado
                return formatResultadoNombre(resultadoNombre.data);
            } else {
                clearConversationState(userId);
                return `❌ Error al realizar la búsqueda: ${resultadoNombre.error}\n\n_Escribe "menu" para intentar nuevamente._`;
            }
            
        case STATES.ESPERANDO_CEDULA:
            if (!validarCedula(normalizedMessage)) {
                return '⚠️ Cédula inválida. Debe contener exactamente 10 dígitos.\n\n📝 Intenta nuevamente:';
            }
            
            // Realizar búsqueda por cédula
            state.state = STATES.MOSTRANDO_RESULTADOS;
            const resultadoCedula = await buscarPorCedula(normalizedMessage);
            
            if (resultadoCedula.success) {
                clearConversationState(userId); // Limpiar después de mostrar resultado
                return formatResultadoCedula(resultadoCedula.data);
            } else {
                clearConversationState(userId);
                return `❌ Error al realizar la búsqueda: ${resultadoCedula.error}\n\n_Escribe "menu" para intentar nuevamente._`;
            }
            
        case STATES.ESPERANDO_PLACA:
            if (!validarPlaca(normalizedMessage)) {
                return '⚠️ Placa inválida. Formato esperado: ABC1234 o ABC-1234\n\n📝 Intenta nuevamente:';
            }
            
            // Realizar búsqueda por placa
            state.state = STATES.MOSTRANDO_RESULTADOS;
            const resultadoPlaca = await buscarPorPlaca(normalizedMessage.toUpperCase());
            
            if (resultadoPlaca.success) {
                clearConversationState(userId); // Limpiar después de mostrar resultado
                return formatResultadoPlaca(resultadoPlaca.data);
            } else {
                clearConversationState(userId);
                return `❌ Error al realizar la búsqueda: ${resultadoPlaca.error}\n\n_Escribe "menu" para intentar nuevamente._`;
            }
            
        default:
            // Estado desconocido, reiniciar
            return startMenu(userId);
    }
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
    if (!state || state.state === STATES.IDLE) return false;
    
    // Verificar si la sesión está expirada
    if (Date.now() - state.lastInteraction > MENU_TIMEOUT) {
        clearConversationState(userId);
        return false;
    }
    
    return true;
}

// Obtener estado actual del usuario
function getCurrentMenu(userId) {
    const state = conversationStates.get(userId);
    if (!state) return null;
    
    // Array de títulos aleatorios
    const titulos = [
        '👤 Búsqueda de Personas',
        '🔎 Consulta de Datos Personales',
        '👥 Consulta de Ciudadanos',
        '👤 Información del Ciudadano',
        '🧾 Verificación de Identidad',
        '📋 Revisión de Datos Registrales',
        '🕵️‍♂️ Localizador de Personas',
        '📘 Consulta de Información Civil',
        '📇 Consulta del Registro de Personas',
        '💼 Información Identificativa',
        '🗂️ Datos del Ciudadano',
        '🧍‍♂️ Información Personal Encontrada',
        '📁 Detalles del Registro Ciudadano',
        '🔍 Identificación y Verificación',
        '🧭 Localización de Datos Personales',
        '🪪 Consulta del Documento de Identidad',
        '👫 Información de Personas Registradas',
        '📑 Verificación de Datos Civiles',
        '🗃️ Consulta del Archivo Ciudadano'
    ];
    
    // Seleccionar un título aleatorio
    const tituloAleatorio = titulos[Math.floor(Math.random() * titulos.length)];
    
    return {
        id: state.state,
        title: tituloAleatorio,
        state: state.state
    };
}

// Exportar funciones
module.exports = {
    startMenu,
    processUserResponse,
    isInActiveMenu,
    getCurrentMenu,
    clearConversationState,
    MENUS,
    STATES
};
