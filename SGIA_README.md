# SGIA - Sistema de Inteligencia Artificial

## Descripción

SGIA es un módulo profesional para integrar tu API de IA (Dify) con el bot de WhatsApp. Permite que el bot responda automáticamente a los mensajes de los usuarios usando inteligencia artificial.

## Características

✅ **Código limpio y profesional** siguiendo las mejores prácticas de JavaScript
✅ **Manejo robusto de errores** con reintentos automáticos
✅ **Timeout configurable** para evitar esperas infinitas
✅ **Validación de datos** de entrada y salida
✅ **Logging detallado** para debugging
✅ **Patrón Singleton** para optimizar recursos
✅ **Documentación completa** con JSDoc

## Configuración

### Variables de Entorno

Configura las siguientes variables en tu archivo `.env`:

```bash
# Token de autorización de tu API Dify
SGIA_SECRET=tu_token_secreto_aqui

# URL base de tu API Dify (sin el /chat-messages)
URL_API_DIFY=https://tu-api-dify.com/v1
```

### Docker Compose

Las variables ya están configuradas en `docker-compose.yml`:

```yaml
environment:
  - SGIA_SECRET=${SGIA_SECRET}
  - URL_API_DIFY=${URL_API_DIFY}
```

## Uso

### Uso Básico

El bot responde automáticamente a todos los mensajes de texto:

```javascript
const { queryAI } = require('./SGIA');

// Consultar a la IA
const respuesta = await queryAI(mensajeDelUsuario, numeroDeWhatsApp);
```

### Uso Avanzado

Si necesitas más control, puedes usar la clase directamente:

```javascript
const { getSGIAInstance } = require('./SGIA');

const sgia = getSGIAInstance();

// Consultar a la IA
const respuesta = await sgia.query(mensaje, numeroTelefono);

// Verificar el estado de la API
const health = await sgia.healthCheck();
console.log(health.status); // 'ok' o 'error'
```

## API del Módulo

### `queryAI(message, phoneNumber)`

Función principal para consultar a la IA.

**Parámetros:**
- `message` (string): Mensaje del usuario
- `phoneNumber` (string): Número de WhatsApp (formato: 593999084759@s.whatsapp.net)

**Retorna:** `Promise<string>` - Respuesta de la IA

**Ejemplo:**
```javascript
const respuesta = await queryAI("Hola, ¿cómo estás?", "593999084759@s.whatsapp.net");
console.log(respuesta); // "¡Hola! Estoy muy bien, gracias por preguntar..."
```

### `checkHealth()`

Verifica el estado de conexión con la API.

**Retorna:** `Promise<Object>`
```javascript
{
  status: 'ok' | 'error',
  message: string,
  response?: string
}
```

### Clase `SGIAClient`

Clase principal con métodos avanzados:

#### `query(userMessage, phoneNumber)`
Realiza una consulta a la API con manejo completo de errores.

#### `healthCheck()`
Verifica el estado de la API.

#### `normalizePhoneNumber(phoneNumber)`
Normaliza el formato del número de teléfono.

#### `sanitizeMessage(message)`
Limpia y valida el mensaje del usuario.

## Formato de la API

### Request

```json
POST {{URL_API_DIFY}}/chat-messages
Authorization: Bearer {{SGIA_SECRET}}
Content-Type: application/json

{
  "query": "Hola, ¿quién eres?",
  "inputs": {},
  "response_mode": "blocking",
  "user": "593999084759"
}
```

### Response Esperada

El módulo acepta múltiples formatos de respuesta:

```json
{
  "answer": "Respuesta de la IA aquí..."
}
```

O también:
```json
{
  "message": "Respuesta de la IA aquí..."
}
```

O:
```json
{
  "data": {
    "answer": "Respuesta de la IA aquí..."
  }
}
```

## Características de Robustez

### Reintentos Automáticos

El módulo reintenta automáticamente hasta **2 veces** en caso de:
- Timeout de la solicitud
- Errores de conexión
- Errores temporales de red

### Timeout

Cada solicitud tiene un timeout de **30 segundos** por defecto.

### Backoff Exponencial

Los reintentos utilizan un backoff exponencial:
- Primer reintento: 1 segundo de espera
- Segundo reintento: 2 segundos de espera

### Manejo de Errores

Todos los errores son capturados y convertidos en mensajes amigables para el usuario:

- **Timeout**: "La consulta está tardando más de lo esperado..."
- **Sin conexión**: "No puedo conectarme con el servicio de IA..."
- **No configurado**: "El servicio de IA no está configurado correctamente."
- **Otros errores**: "Ocurrió un error al procesar tu mensaje..."

## Logs

El módulo genera logs detallados para debugging:

```
📤 [SGIA] Enviando consulta de usuario 593999084759
   Mensaje: "Hola, ¿cómo estás?"
📥 [SGIA] Respuesta recibida en 1250ms
✅ [SGIA] Respuesta generada: "¡Hola! Estoy muy bien..."
```

En caso de error:
```
❌ [SGIA] Error al consultar la API: No se pudo conectar con la API de IA
```

## Integración en index.js

El módulo está integrado automáticamente en el manejo de mensajes:

```javascript
// Cuando llega un mensaje de texto
if (messageType === 'text' && body && !body.startsWith('[')) {
    const aiResponse = await queryAI(body, contact);
    
    if (aiResponse) {
        await sock.sendMessage(contact, { text: aiResponse });
        console.log(`🤖 Respuesta de IA enviada a ${contact}`);
    }
}
```

## Mejores Prácticas

1. ✅ **Validación de entrada**: Todos los datos son validados antes de enviarlos
2. ✅ **Sanitización**: Los mensajes son limpiados de espacios innecesarios
3. ✅ **Singleton**: Una sola instancia del cliente para toda la aplicación
4. ✅ **Async/Await**: Código asíncrono moderno y legible
5. ✅ **Error handling**: Manejo completo de errores con try/catch
6. ✅ **Logging**: Logs detallados para debugging
7. ✅ **Documentación**: JSDoc completo en todas las funciones
8. ✅ **Configuración centralizada**: Clase SGIAConfig para configuración

## Testing

Para probar la conexión:

```javascript
const { checkHealth } = require('./SGIA');

// Verificar estado
const health = await checkHealth();
console.log(health);
```

## Troubleshooting

### Error: "URL_API_DIFY no está configurada"
- Verifica que la variable de entorno esté definida en tu `.env`
- Verifica que Docker Compose esté pasando correctamente la variable

### Error: "No se pudo conectar con la API de IA"
- Verifica que la URL de la API sea correcta
- Verifica que la API esté accesible desde el contenedor Docker
- Verifica la conectividad de red

### Error: "La solicitud excedió el tiempo límite"
- La API está tardando más de 30 segundos en responder
- Considera aumentar el timeout en `SGIAConfig`

### La respuesta está vacía
- Verifica que el formato de respuesta de tu API sea compatible
- Revisa los logs para ver la respuesta completa de la API

## Arquitectura

```
┌─────────────────┐
│   WhatsApp Bot  │
│   (index.js)    │
└────────┬────────┘
         │
         │ queryAI()
         ▼
┌─────────────────┐
│  SGIA Module    │
│   (SGIA.js)     │
├─────────────────┤
│ - Validation    │
│ - Retry Logic   │
│ - Error Handle  │
└────────┬────────┘
         │
         │ HTTP POST
         ▼
┌─────────────────┐
│   Dify API      │
│ /chat-messages  │
└─────────────────┘
```

## Personalización

### Cambiar el timeout

```javascript
// En SGIA.js, clase SGIAConfig
this.timeout = 60000; // 60 segundos
```

### Cambiar el número de reintentos

```javascript
// En SGIA.js, clase SGIAConfig
this.retries = 5; // 5 reintentos
```

### Agregar headers adicionales

```javascript
// En SGIA.js, método makeRequest
headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${this.config.secret}`,
    'X-Custom-Header': 'valor'
}
```

## Licencia

Este módulo es parte del proyecto whatsapp-baileys2.

## Soporte

Para reportar issues o sugerencias, contacta al equipo de desarrollo.
