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
    MOSTRANDO_RESULTADOS: 'MOSTRANDO_RESULTADOS'
};

// Definición de menús
const MENUS = {
    PRINCIPAL: {
        id: 'PRINCIPAL',
        title: '🔍 *Búsqueda de Personas*',
        message: 'Bienvenido al sistema de búsqueda.\n\n¿Cómo deseas buscar?\n\n1️⃣ Buscar por Nombre\n2️⃣ Buscar por Cédula\n0️⃣ Salir\n\n_Escribe el número de tu opción_',
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

// Función para buscar por cédula en API Colmena
async function buscarPorCedula(cedula) {
    try {
        const baseUrl = process.env.URL_CEDULA || 'https://datos.los4rios.com/api_abeja/';
        const authorization = process.env.AUTHORIZATION || '';
        
        // Construir URL con query parameters
        const url = `${baseUrl}${encodeURIComponent(cedula)}`;
        
        console.log(`🔍 Buscando cédula: ${cedula} en ${url}`);
        console.log(`🔑 Authorization presente: ${authorization ? 'Sí (longitud: ' + authorization.length + ')' : 'No'}`);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authorization}` 
            }
        });

        console.log(`📡 Status de respuesta: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Error HTTP: ${response.status} ${response.statusText}`);
            console.error(`📄 Respuesta del servidor: ${errorText.substring(0, 500)}`);
            return { success: false, error: `Error HTTP: ${response.status}` };
        }

        const data = await response.json();
        console.log('✅ Respuesta API Colmena:', JSON.stringify(data).substring(0, 200));
        
        return { success: true, data: data };
    } catch (error) {
        console.error('❌ Error al buscar por cédula:', error);
        return { success: false, error: error.message };
    }
}

// Función para buscar por nombre en API Nombres
async function buscarPorNombre(nombre) {
    try {
        const baseUrl = process.env.URL_NOMBRES || 'https://datos.los4rios.com/api_busca_nombres/';
        const authorization = process.env.AUTHORIZATION_NOMBRES || '';
        
        // Construir URL con query parameters
        const url = `${baseUrl}${encodeURIComponent(nombre)}`;
        
        console.log(`🔍 Buscando nombre: ${nombre} en ${url}`);
        console.log(`🔑 Authorization presente: ${authorization ? 'Sí (longitud: ' + authorization.length + ')' : 'No'}`);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authorization
            }
        });

        console.log(`📡 Status de respuesta: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Error HTTP: ${response.status} ${response.statusText}`);
            console.error(`📄 Respuesta del servidor: ${errorText.substring(0, 500)}`);
            return { success: false, error: `Error HTTP: ${response.status}` };
        }

        const data = await response.json();
        console.log('✅ Respuesta API Nombres:', JSON.stringify(data).substring(0, 200));
        
        return { success: true, data: data };
    } catch (error) {
        console.error('❌ Error al buscar por nombre:', error);
        return { success: false, error: error.message };
    }
}

// Formatear resultados de búsqueda por cédula
function formatResultadoCedula(data) {
    if (!data || typeof data !== 'object') {
        return { mensaje: '❌ No se encontraron resultados para esta cédula.', photo: null };
    }

    let mensaje = '✅ *Resultado de la búsqueda*\n\n';
    let photoUrl = null;
    
    // Verificar si existe el campo "existe"
    if (data.existe === 'no') {
        return { mensaje: '❌ No se encontró información para esta cédula.', photo: null };
    }
    
    // Si viene con estructura {existe: "si", data: {...}}
    if (data.existe === 'si' && data.data) {
        const persona = Array.isArray(data.data) ? data.data[0] : data.data;
        
        if (!persona) {
            return { mensaje: '❌ No se encontró información para esta cédula.', photo: null };
        }
        
        // Capturar la URL de la foto si existe y construir la URL completa
        if (persona.photo || persona.foto || persona.imagen) {
            const photoPath = persona.photo || persona.foto || persona.imagen;
            const baseUrl = process.env.URL || 'https://datos.los4rios.com';
            
            // Si la ruta de la foto comienza con /, construir URL completa
            if (photoPath.startsWith('/')) {
                photoUrl = `${baseUrl}${photoPath}`;
            } else {
                photoUrl = `${baseUrl}/${photoPath}`;
            }
            
            console.log(`📸 URL de foto construida: ${photoUrl}`);
        }
        
        mensaje += `👤 *Nombre:* ${persona.nombrescompletos || persona.nombres || persona.nombre || 'N/A'}\n`;
        mensaje += `📋 *Cédula:* ${persona.identificacion || persona.cedula || 'N/A'}\n`;
        
        if (persona.nacimiento || persona.fecha_nacimiento || persona.fechaNacimiento) {
            const fechaNac = persona.nacimiento || persona.fecha_nacimiento || persona.fechaNacimiento;
            mensaje += `🎂 *Fecha Nacimiento:* ${fechaNac}`;
            
            // Calcular edad
            const edad = calcularEdad(fechaNac);
            if (edad !== null) {
                mensaje += ` *(${edad} años)*`;
            }
            mensaje += '\n';
        }
        
        if (persona.estado_civil || persona.estadoCivil) {
            mensaje += `💑 *Estado Civil:* ${persona.estado_civil || persona.estadoCivil}\n`;
        }
        
        if (persona.direccion) {
            mensaje += `🏠 *Dirección:* ${persona.direccion}\n`;
        }
        
        if (persona.telefono) {
            mensaje += `📞 *Teléfono:* ${persona.telefono}\n`;
        }

        if (persona.celular) {
            mensaje += `📱 *Celular:* ${persona.celular}\n`;
        }
        
        if (persona.correo) {
            mensaje += `📧 *Email:* ${persona.correo}\n`;
        }
        
        // ===== ESTUDIOS BÁSICOS =====
        if (persona.basicos && Array.isArray(persona.basicos) && persona.basicos.length > 0) {
            mensaje += `\n📚 *Estudios Básicos:*\n`;
            persona.basicos.forEach((estudio, index) => {
                mensaje += `   ${index + 1}. ${estudio.titulo || 'N/A'}\n`;
                if (estudio.institucion) {
                    mensaje += `      🏫 ${estudio.institucion}\n`;
                }
                if (estudio.especialidad) {
                    mensaje += `      📖 Especialidad: ${estudio.especialidad}\n`;
                }
            });
        }
        
        // ===== ESTUDIOS SUPERIORES =====
        if (persona.superiores && Array.isArray(persona.superiores) && persona.superiores.length > 0) {
            mensaje += `\n🎓 *Estudios Superiores:*\n`;
            persona.superiores.forEach((estudio, index) => {
                mensaje += `   ➤ `;
                if (estudio.nivel) {
                    mensaje += `*${estudio.nivel}* - `;
                }
                mensaje += `${estudio.titulo || 'N/A'}\n`;
                if (estudio.institucion) {
                    mensaje += `      🏫 ${estudio.institucion}\n`;
                }
                if (estudio.fechagraduacion) {
                    mensaje += `      📅 Graduación: ${estudio.fechagraduacion}\n`;
                }
            });
        }
    }
    // Intentar otras estructuras de respuesta
    else if (data.persona || data.data || data.resultado) {
        const persona = data.persona || data.data || data.resultado;
        
        // Capturar la URL de la foto si existe y construir la URL completa
        if (persona.photo || persona.foto || persona.imagen) {
            const photoPath = persona.photo || persona.foto || persona.imagen;
            const baseUrl = process.env.URL || 'https://datos.los4rios.com';
            
            // Si la ruta de la foto comienza con /, construir URL completa
            if (photoPath.startsWith('/')) {
                photoUrl = `${baseUrl}${photoPath}`;
            } else {
                photoUrl = `${baseUrl}/${photoPath}`;
            }
            
            console.log(`📸 URL de foto construida: ${photoUrl}`);
        }
        
        mensaje += `👤 *Nombre:* ${persona.nombrescompletos || persona.nombres || persona.nombre || 'N/A'}\n`;
        mensaje += `📋 *Cédula:* ${persona.identificacion || persona.cedula || 'N/A'}\n`;
        
        if (persona.nacimiento || persona.fecha_nacimiento || persona.fechaNacimiento) {
            const fechaNac = persona.nacimiento || persona.fecha_nacimiento || persona.fechaNacimiento;
            mensaje += `🎂 *Fecha Nacimiento:* ${fechaNac}`;
            
            // Calcular edad
            const edad = calcularEdad(fechaNac);
            if (edad !== null) {
                mensaje += ` (${edad} años)`;
            }
            mensaje += '\n';
        }
        
        if (persona.estado_civil || persona.estadoCivil) {
            mensaje += `💑 *Estado Civil:* ${persona.estado_civil || persona.estadoCivil}\n`;
        }
        
        if (persona.direccion) {
            mensaje += `🏠 *Dirección:* ${persona.direccion}\n`;
        }
        
        if (persona.telefono) {
            mensaje += `📞 *Teléfono:* ${persona.telefono}\n`;
        }

        if (persona.celular) {
            mensaje += `📱 *Celular:* ${persona.celular}\n`;
        }
        
        if (persona.correo) {
            mensaje += `📧 *Email:* ${persona.correo}\n`;
        }
        
        // ===== ESTUDIOS BÁSICOS =====
        if (persona.basicos && Array.isArray(persona.basicos) && persona.basicos.length > 0) {
            mensaje += `\n📚 *Estudios Básicos:*\n`;
            persona.basicos.forEach((estudio, index) => {
                mensaje += `   ${index + 1}. ${estudio.titulo || 'N/A'}\n`;
                if (estudio.institucion) {
                    mensaje += `      🏫 ${estudio.institucion}\n`;
                }
                if (estudio.especialidad) {
                    mensaje += `      📖 Especialidad: ${estudio.especialidad}\n`;
                }
            });
        }
        
        // ===== ESTUDIOS SUPERIORES =====
        if (persona.superiores && Array.isArray(persona.superiores) && persona.superiores.length > 0) {
            mensaje += `\n🎓 *Estudios Superiores:*\n`;
            persona.superiores.forEach((estudio, index) => {
                mensaje += `  ➡️ ${index + 1}. `;
                if (estudio.nivel) {
                    mensaje += `*${estudio.nivel}* - `;
                }
                mensaje += `${estudio.titulo || 'N/A'}\n`;
                if (estudio.institucion) {
                    mensaje += `      🏫 ${estudio.institucion}\n`;
                }
                if (estudio.fechagraduacion) {
                    mensaje += `      📅 Graduación: ${estudio.fechagraduacion}\n`;
                }
            });
        }
    } else {
        // Si la estructura es diferente, mostrar datos disponibles
        mensaje += '📋 *Información disponible:*\n\n';
        for (const [key, value] of Object.entries(data)) {
            if (typeof value !== 'object') {
                mensaje += `*${key}:* ${value}\n`;
            }
        }
    }
    
    mensaje += '\n_Escribe "menu" para volver al menú principal_';
    return { mensaje, photo: photoUrl };
}

// Formatear resultados de búsqueda por nombre
function formatResultadoNombre(data) {
    if (!data) {
        return '❌ No se encontraron resultados para este nombre.';
    }

    let mensaje = '✅ *Resultados de la búsqueda*\n\n';
    
    // Verificar si existe el campo "existe"
    if (data.existe === 'no' || (data.existe === 'si' && (!data.data || data.data.length === 0))) {
        return '❌ No se encontraron personas con ese nombre.';
    }
    
    // Si viene con estructura {existe: "si", data: [...]}
    if (data.existe === 'si' && Array.isArray(data.data)) {
        const resultados = data.data;
        
        mensaje += `_Se encontraron ${resultados.length} resultado(s):_\n\n`;
        
        // Limitar a los primeros 5 resultados
        const resultadosLimitados = resultados.slice(0, 10);
        resultadosLimitados.forEach((persona, index) => {
            mensaje += `*${index + 1}.* `;
            mensaje += `${persona.nombrescompletos || persona.nombres || 'N/A'}\n`;
            mensaje += `   📋 Cédula: ${persona.identificacion || persona.cedula || 'N/A'}\n`;
            
            if (persona.nacimiento || persona.fecha_nacimiento) {
                mensaje += `   🎂 Nacimiento: ${persona.nacimiento || persona.fecha_nacimiento}\n`;
            }
            
            mensaje += '\n';
        });
        
        if (resultados.length > 5) {
            mensaje += `_...y ${resultados.length - 5} resultado(s) más_\n\n`;
        }
    }
    // Si es un array de resultados directo
    else if (Array.isArray(data)) {
        if (data.length === 0) {
            return '❌ No se encontraron personas con ese nombre.';
        }
        
        mensaje += `_Se encontraron ${data.length} resultado(s):_\n\n`;
        
        // Limitar a los primeros 5 resultados
        const resultados = data.slice(0, 5);
        resultados.forEach((persona, index) => {
            mensaje += `*${index + 1}.* `;
            mensaje += `${persona.nombrescompletos || persona.nombres || persona.nombre || 'N/A'}\n`;
            mensaje += `   📋 Cédula: ${persona.identificacion || persona.cedula || 'N/A'}\n`;
            
            if (persona.nacimiento || persona.fecha_nacimiento || persona.fechaNacimiento) {
                mensaje += `   🎂 Nacimiento: ${persona.nacimiento || persona.fecha_nacimiento || persona.fechaNacimiento}\n`;
            }
            
            mensaje += '\n';
        });
        
        if (data.length > 5) {
            mensaje += `_...y ${data.length - 5} resultado(s) más_\n\n`;
        }
    } 
    // Si es un objeto con resultados
    else if (data.resultados && Array.isArray(data.resultados)) {
        return formatResultadoNombre(data.resultados);
    }
    // Si es un solo resultado
    else if (typeof data === 'object') {
        mensaje += `👤 *Nombre:* ${data.nombrescompletos || data.nombres || data.nombre || 'N/A'}\n`;
        mensaje += `📋 *Cédula:* ${data.identificacion || data.cedula || 'N/A'}\n`;
        
        if (data.nacimiento || data.fecha_nacimiento || data.fechaNacimiento) {
            mensaje += `🎂 *Fecha Nacimiento:* ${data.nacimiento || data.fecha_nacimiento || data.fechaNacimiento}\n`;
        }
    }
    
    mensaje += '\n_Escribe "menu" para volver al menú principal_';
    return mensaje;
}

// Calcular edad a partir de fecha de nacimiento
function calcularEdad(fechaNacimiento) {
    if (!fechaNacimiento) return null;
    
    try {
        // Intentar parsear diferentes formatos de fecha
        let fecha;
        
        // Formato: YYYY-MM-DD o YYYY/MM/DD
        if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(fechaNacimiento)) {
            fecha = new Date(fechaNacimiento);
        }
        // Formato: DD-MM-YYYY o DD/MM/YYYY
        else if (/^\d{2}[-/]\d{2}[-/]\d{4}/.test(fechaNacimiento)) {
            const partes = fechaNacimiento.split(/[-/]/);
            fecha = new Date(partes[2], partes[1] - 1, partes[0]);
        }
        else {
            // Intentar parsear directamente
            fecha = new Date(fechaNacimiento);
        }
        
        // Verificar si la fecha es válida
        if (isNaN(fecha.getTime())) {
            return null;
        }
        
        const hoy = new Date();
        let edad = hoy.getFullYear() - fecha.getFullYear();
        const mes = hoy.getMonth() - fecha.getMonth();
        
        // Ajustar si aún no ha cumplido años este año
        if (mes < 0 || (mes === 0 && hoy.getDate() < fecha.getDate())) {
            edad--;
        }
        
        return edad >= 0 ? edad : null;
    } catch (error) {
        console.error('Error al calcular edad:', error);
        return null;
    }
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
                return '👤 *Búsqueda por Nombre*\n\n📝 Por favor, escribe el nombre completo o parcial de la persona que deseas buscar:\n\n_Ejemplo: Juan Pérez_';
            } else if (normalizedMessage === '2') {
                // Búsqueda por cédula
                state.state = STATES.ESPERANDO_CEDULA;
                return '🆔 *Búsqueda por Cédula*\n\n📝 Por favor, escribe el número de cédula (10 dígitos):\n\n_Ejemplo: 1234567890_';
            } else {
                return '❌ Opción no válida.\n\n' + formatMenuMessage(MENUS.PRINCIPAL);
            }
            
        case STATES.ESPERANDO_NOMBRE:
            if (normalizedMessage.length < 3) {
                return '⚠️ El nombre debe tener al menos 3 caracteres.\n\n📝 Intenta nuevamente:';
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
    
    return {
        id: state.state,
        title: 'Búsqueda de Personas',
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
