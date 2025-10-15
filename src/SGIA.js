// src/SGIA.js
/**
 * @module SGIA
 * @description Módulo para interactuar con la API de IA (Dify) y gestionar respuestas automáticas
 * @version 1.0.0
 */

const fetch = require('node-fetch').default;

/**
 * Configuración del módulo SGIA
 */
class SGIAConfig {
    constructor() {
        this.apiUrl = process.env.URL_API_DIFY;
        this.secret = process.env.SGIA_SECRET;
        this.timeout = 30000; // 30 segundos
        this.retries = 2;
    }

    /**
     * Valida que la configuración esté completa
     * @returns {boolean} True si la configuración es válida
     * @throws {Error} Si falta alguna variable de entorno requerida
     */
    validate() {
        if (!this.apiUrl) {
            throw new Error('URL_API_DIFY no está configurada en las variables de entorno');
        }
        if (!this.secret) {
            throw new Error('SGIA_SECRET no está configurado en las variables de entorno');
        }
        return true;
    }

    /**
     * Obtiene la URL completa del endpoint
     * @returns {string} URL del endpoint chat-messages
     */
    getEndpoint() {
        return `${this.apiUrl}/chat-messages`;
    }
}

/**
 * Cliente SGIA para interactuar con la API de IA
 */
class SGIAClient {
    constructor() {
        this.config = new SGIAConfig();
        this.config.validate();
    }

    /**
     * Normaliza el número de teléfono de WhatsApp
     * @param {string} phoneNumber - Número en formato WhatsApp (ej: 593999084759@s.whatsapp.net)
     * @returns {string} Número normalizado
     */
    normalizePhoneNumber(phoneNumber) {
        if (!phoneNumber) return 'unknown_user';
        // Extraer solo el número, sin el dominio de WhatsApp
        return phoneNumber.split('@')[0];
    }

    /**
     * Sanitiza el mensaje del usuario
     * @param {string} message - Mensaje a sanitizar
     * @returns {string} Mensaje sanitizado
     */
    sanitizeMessage(message) {
        if (!message || typeof message !== 'string') {
            return '';
        }
        return message.trim();
    }

    /**
     * Realiza una petición a la API con reintentos
     * @param {string} query - Mensaje del usuario
     * @param {string} user - Identificador del usuario
     * @param {number} attempt - Intento actual (para reintentos)
     * @returns {Promise<Object>} Respuesta de la API
     */
    async makeRequest(query, user, attempt = 1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            const response = await fetch(this.config.getEndpoint(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.secret}`
                },
                body: JSON.stringify({
                    query,
                    inputs: {},
                    response_mode: 'blocking',
                    user
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    `Error HTTP ${response.status}: ${response.statusText} - ${errorText}`
                );
            }

            return await response.json();

        } catch (error) {
            clearTimeout(timeoutId);

            // Manejo de timeout
            if (error.name === 'AbortError') {
                console.error(`⏱️ [SGIA] Timeout en intento ${attempt} de ${this.config.retries + 1}`);
                
                if (attempt <= this.config.retries) {
                    console.log(`🔄 [SGIA] Reintentando... (${attempt}/${this.config.retries})`);
                    await this.delay(1000 * attempt); // Backoff exponencial
                    return this.makeRequest(query, user, attempt + 1);
                }
                
                throw new Error('La solicitud a la API excedió el tiempo límite');
            }

            // Manejo de errores de red
            if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
                if (attempt <= this.config.retries) {
                    console.log(`🔄 [SGIA] Error de conexión. Reintentando... (${attempt}/${this.config.retries})`);
                    await this.delay(1000 * attempt);
                    return this.makeRequest(query, user, attempt + 1);
                }
                
                throw new Error('No se pudo conectar con la API de IA');
            }

            throw error;
        }
    }

    /**
     * Espera un tiempo determinado (útil para reintentos)
     * @param {number} ms - Milisegundos a esperar
     * @returns {Promise<void>}
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Extrae la respuesta del mensaje de la API
     * @param {Object} apiResponse - Respuesta completa de la API
     * @returns {string} Texto de respuesta
     */
    extractAnswer(apiResponse) {
        // Diferentes formatos posibles de respuesta según la configuración de Dify
        if (apiResponse.answer) {
            return apiResponse.answer;
        }
        if (apiResponse.message) {
            return apiResponse.message;
        }
        if (apiResponse.text) {
            return apiResponse.text;
        }
        if (apiResponse.data?.answer) {
            return apiResponse.data.answer;
        }

        console.warn('⚠️ [SGIA] Formato de respuesta no reconocido:', JSON.stringify(apiResponse));
        return 'Lo siento, no pude procesar la respuesta correctamente.';
    }

    /**
     * Consulta a la API de IA y obtiene una respuesta
     * @param {string} userMessage - Mensaje del usuario
     * @param {string} phoneNumber - Número de WhatsApp del usuario
     * @returns {Promise<string>} Respuesta de la IA
     */
    async query(userMessage, phoneNumber) {
        try {
            // Validar y sanitizar entradas
            const sanitizedMessage = this.sanitizeMessage(userMessage);
            if (!sanitizedMessage) {
                console.warn('⚠️ [SGIA] Mensaje vacío recibido');
                return 'Por favor, envía un mensaje válido.';
            }

            const normalizedUser = this.normalizePhoneNumber(phoneNumber);

            console.log(`📤 [SGIA] Enviando consulta de usuario ${normalizedUser}`);
            console.log(`   Mensaje: "${sanitizedMessage.substring(0, 50)}${sanitizedMessage.length > 50 ? '...' : ''}"`);

            // Realizar la petición
            const startTime = Date.now();
            const apiResponse = await this.makeRequest(sanitizedMessage, normalizedUser);
            const duration = Date.now() - startTime;

            console.log(`📥 [SGIA] Respuesta recibida en ${duration}ms`);

            // Extraer y retornar la respuesta
            const answer = this.extractAnswer(apiResponse);
            
            if (answer) {
                console.log(`✅ [SGIA] Respuesta generada: "${answer.substring(0, 50)}${answer.length > 50 ? '...' : ''}"`);
            }

            return answer;

        } catch (error) {
            console.error('❌ [SGIA] Error al consultar la API:', error.message);
            
            // Mensajes de error amigables para el usuario
            if (error.message.includes('tiempo límite')) {
                return 'Lo siento, la consulta está tardando más de lo esperado. Por favor, intenta nuevamente.';
            }
            if (error.message.includes('No se pudo conectar')) {
                return 'Lo siento, no puedo conectarme con el servicio de IA en este momento. Intenta más tarde.';
            }
            if (error.message.includes('no está configurada')) {
                return 'Lo siento, el servicio de IA no está configurado correctamente.';
            }

            return 'Lo siento, ocurrió un error al procesar tu mensaje. Por favor, intenta nuevamente.';
        }
    }

    /**
     * Verifica el estado de la API
     * @returns {Promise<Object>} Estado de la conexión
     */
    async healthCheck() {
        try {
            const response = await this.query('ping', 'health_check');
            return {
                status: 'ok',
                message: 'API funcionando correctamente',
                response
            };
        } catch (error) {
            return {
                status: 'error',
                message: error.message
            };
        }
    }
}

/**
 * Instancia singleton del cliente SGIA
 */
let sgiaInstance = null;

/**
 * Obtiene la instancia del cliente SGIA (patrón Singleton)
 * @returns {SGIAClient} Instancia del cliente
 */
function getSGIAInstance() {
    if (!sgiaInstance) {
        sgiaInstance = new SGIAClient();
    }
    return sgiaInstance;
}

/**
 * Función de ayuda para realizar una consulta rápida
 * @param {string} message - Mensaje del usuario
 * @param {string} phoneNumber - Número de WhatsApp
 * @returns {Promise<string>} Respuesta de la IA
 */
async function queryAI(message, phoneNumber) {
    const client = getSGIAInstance();
    return await client.query(message, phoneNumber);
}

/**
 * Función de ayuda para verificar el estado de la API
 * @returns {Promise<Object>} Estado de la conexión
 */
async function checkHealth() {
    const client = getSGIAInstance();
    return await client.healthCheck();
}

// Exportar el módulo
module.exports = {
    SGIAClient,
    getSGIAInstance,
    queryAI,
    checkHealth
};
