# 🤖 WhatsApp API con Baileys + Docker

Una API REST sencilla para enviar y recibir mensajes de WhatsApp usando **[Baileys](https://github.com/WhiskeySockets/Baileys)**, empaquetada en **Docker** con persistencia de sesión, soporte para multimedia y gestión de sesiones.

> ⚠️ **Advertencia**: Este proyecto **no usa la API oficial de WhatsApp Business (WABA)**. Se conecta a tu cuenta personal mediante el sistema de "Dispositivos vinculados". **No lo uses para spam, marketing masivo ni actividades abusivas**. WhatsApp podría bloquear tu número.

---

## 🌟 Características

- ✅ Autenticación con código QR (una sola vez, gracias a la persistencia)
- ✅ Envío de mensajes de texto, imágenes, videos, documentos y audio
- ✅ Recepción y registro de mensajes entrantes con estado de lectura
- ✅ Sistema de gestión de mensajes (leídos/no leídos)
- ✅ Responder a mensajes específicos
- ✅ Soporte para múltiples tipos de mensajes (texto, imagen, video, audio, documentos, ubicaciones, contactos, stickers, etc.)
- ✅ API REST para integrar con otros servicios
- ✅ Persistencia de sesión entre reinicios del contenedor
- ✅ Soporte para Node.js 20+ y Docker
- ✅ Logs detallados para depuración
- ✅ Endpoint seguro para cerrar sesión y reconexión

---

## 🛠️ Requisitos

- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/)
- Node.js 20+ (solo para desarrollo local, no necesario en producción)

---

## 🚀 Inicio rápido

1. **Clona el repositorio** (o crea los archivos manualmente):
   ```bash
   git clone <tu-repo> whatsapp-api
   cd whatsapp-api
   ```

2. **Instala dependencias localmente** (opcional, para generar package-lock.json):
   ```bash
   npm install
   ```

3. **Construye y levanta el contenedor**:
   ```bash
   docker-compose up --build
   ```

4. **Escanea el código QR**:
   - Observa los logs:
     ```bash
     docker-compose logs -f whatsapp-api
     ```
   - Escanea el QR con tu app de WhatsApp:
     `Ajustes → Dispositivos vinculados → Vincular dispositivo`

5. **¡Listo!** Tu API está corriendo en `http://localhost:3080`

---

## 📡 Endpoints de la API

### 📤 Enviar mensaje

```http
POST /send-all
```

**Cuerpo (JSON):**

```json
{
  "to": "593995707647",
  "message": "Hola mundo",
  "media": "https://ejemplo.com/imagen.jpg",
  "mediaType": "image"
}
```

**Parámetros:**
- `to`: número con código de país, sin `+` (ej. `593995707647`)
- `message` (opcional): texto del mensaje
- `media` (opcional): URL pública o base64
- `mediaType` (opcional): `image`, `video`, `document`, `audio` (por defecto: `image`)

### 📥 Ver mensajes entrantes

```http
GET /messages
GET /messages?unreadOnly=true
```

**Respuesta:**
```json
{
  "count": 3,
  "total": 5,
  "unread": 3,
  "messages": [
    {
      "id": "ABC123",
      "from": "593995707647@s.whatsapp.net",
      "body": "Hola, cómo estás?",
      "timestamp": "1760477803",
      "type": "text",
      "read": false
    }
  ]
}
```

**Query params:**
- `unreadOnly=true` (opcional): Devuelve solo mensajes no leídos

### 💬 Responder a un mensaje

```http
POST /messages/reply
```

**Cuerpo (JSON):**
```json
{
  "messageId": "ABC123",
  "message": "Hola! Estoy bien, gracias"
}
```

Responde a un mensaje específico y lo marca automáticamente como leído.

### ✅ Marcar mensajes como leídos

```http
POST /messages/mark-read
```

**Cuerpo (JSON):**
```json
{
  "messageIds": ["ABC123", "DEF456"]
}
```

### 🗑️ Eliminar mensajes leídos

```http
DELETE /messages/read
```

Elimina todos los mensajes que han sido marcados como leídos.

### 🧹 Limpiar todos los mensajes

```http
DELETE /messages
```

Elimina todos los mensajes (leídos y no leídos).

### 📊 Estado de conexión

```http
GET /status
```

Devuelve `connected`, `connecting` o `disconnected`.

### 🔐 Código QR

```http
GET /qr
```

Obtiene el código QR para autenticación (si está disponible).

### 🚪 Cerrar sesión

```http
POST /logout
```

**Cuerpo (JSON):**
```json
{
  "secret": "tu_secreto_configurado"
}
```

Cierra la sesión actual y genera un nuevo QR para reconexión.

---

## 🗃️ Persistencia

- Las credenciales de WhatsApp se guardan en `./session/` (gracias al volumen de Docker)
- Los mensajes entrantes se almacenan en memoria con estado de lectura (se pierden al reiniciar)
- La sesión persiste entre reinicios del contenedor
- Estado de mensajes (leído/no leído) se mantiene durante la ejecución

---

## 📨 Tipos de mensajes soportados

La API puede recibir y procesar los siguientes tipos de mensajes:

- ✅ **Texto** - Mensajes de texto simple y con formato
- ✅ **Imágenes** - Con o sin caption
- ✅ **Videos** - Con o sin caption
- ✅ **Audio** - Archivos de audio y notas de voz
- ✅ **Documentos** - PDFs, Word, Excel, etc.
- ✅ **Stickers** - Stickers animados y estáticos
- ✅ **Contactos** - Contactos compartidos
- ✅ **Ubicaciones** - Ubicaciones estáticas y en vivo
- ✅ **GIFs** - GIFs animados
- ✅ **Reacciones** - Emojis de reacción a mensajes
- ⚠️ **Listas y botones** - Soporte básico
- 🔇 **Mensajes del sistema** - Ignorados automáticamente (mensajes eliminados, editados, etc.)

---

## 🔄 Flujo de trabajo recomendado

1. **Consultar mensajes nuevos:**
   ```bash
   curl http://localhost:3080/messages?unreadOnly=true
   ```

2. **Procesar y responder:**
   ```bash
   curl -X POST http://localhost:3080/messages/reply \
     -H "Content-Type: application/json" \
     -d '{"messageId": "ABC123", "message": "Tu respuesta"}'
   ```

3. **Limpiar mensajes procesados:**
   ```bash
   curl -X DELETE http://localhost:3080/messages/read
   ```

---

## 🧪 Ejemplos de uso

### Enviar texto

```bash
curl -X POST http://localhost:3080/send-all \
  -H "Content-Type: application/json" \
  -d '{"to": "593995707647", "message": "¡Hola desde Docker!"}'
```

### Enviar imagen

```bash
curl -X POST http://localhost:3080/send-all \
  -H "Content-Type: application/json" \
  -d '{
    "to": "593995707647",
    "message": "Mira esta foto",
    "media": "https://picsum.photos/200",
    "mediaType": "image"
  }'
```

### Obtener mensajes no leídos

```bash
curl http://localhost:3080/messages?unreadOnly=true
```

### Responder a un mensaje

```bash
curl -X POST http://localhost:3080/messages/reply \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "ABC123",
    "message": "Gracias por tu mensaje!"
  }'
```

### Marcar mensajes como leídos

```bash
curl -X POST http://localhost:3080/messages/mark-read \
  -H "Content-Type: application/json" \
  -d '{
    "messageIds": ["ABC123", "DEF456"]
  }'
```

### Eliminar mensajes leídos

```bash
curl -X DELETE http://localhost:3080/messages/read
```

### Verificar estado

```bash
curl http://localhost:3080/status
```

### Cerrar sesión

```bash
curl -X POST http://localhost:3080/logout \
  -H "Content-Type: application/json" \
  -d '{"secret": "tu_secreto_configurado"}'
```

---

## ⚙️ Configuración

### Variables de entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
LOGOUT_SECRET=tu_secreto_super_seguro_aqui
```

O modifica el `docker-compose.yml` directamente:

```yaml
environment:
  - LOGOUT_SECRET=tu_secreto_super_seguro_aqui
```

### Puertos

- Puerto externo: `3080`
- Puerto interno del contenedor: `8080`

---

## 📦 Tecnologías usadas

- **Baileys** v6.7.20 - Cliente no oficial de WhatsApp
- **Node.js** 20+ - Runtime de JavaScript
- **Express** - Framework web para la API REST
- **Docker** y **Docker Compose** - Contenerización

---

## ⚠️ Limitaciones conocidas

- Los mensajes enviados muestran una advertencia en el chat:
  *"Este mensaje no desaparecerá del chat. Es posible que el remitente tenga una versión desactualizada de WhatsApp."*
  → Esto es normal al usar clientes no oficiales.
- Los mensajes en memoria se pierden al reiniciar el contenedor
- La sesión expira si no se usa en ~21 días
- Soporte limitado para encuestas y algunas funciones avanzadas

---

## 📜 Licencia

Este proyecto es de código abierto bajo la licencia MIT.

**Baileys** es mantenido por la comunidad y no está afiliado a WhatsApp Inc.

