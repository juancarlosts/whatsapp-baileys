# 🤖 WhatsApp API con Baileys + Docker

Una API REST sencilla para enviar y recibir mensajes de WhatsApp usando **[Baileys](https://github.com/WhiskeySockets/Baileys)**, empaquetada en **Docker** con persistencia de sesión, soporte para multimedia y gestión de sesiones.

> ⚠️ **Advertencia**: Este proyecto **no usa la API oficial de WhatsApp Business (WABA)**. Se conecta a tu cuenta personal mediante el sistema de "Dispositivos vinculados". **No lo uses para spam, marketing masivo ni actividades abusivas**. WhatsApp podría bloquear tu número.

---

## 🌟 Características

- ✅ Autenticación con código QR (una sola vez, gracias a la persistencia)
- ✅ Envío de mensajes de texto, imágenes, videos, documentos y audio
- ✅ Recepción y registro de mensajes entrantes
- ✅ API REST para integrar con otros servicios
- ✅ Persistencia de sesión entre reinicios del contenedor
- ✅ Soporte para Node.js 20+ y Docker
- ✅ Logs detallados para depuración
- ✅ Endpoint seguro para cerrar sesión

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
```

Devuelve todos los mensajes recibidos.

### 🧹 Limpiar mensajes entrantes

```http
DELETE /messages
```

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
- Los mensajes entrantes se almacenan en memoria (se pierden al reiniciar)
- La sesión persiste entre reinicios del contenedor

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
- No soporta mensajes efímeros, encuestas, ubicaciones, etc.
- La sesión expira si no se usa en ~21 días

---

## 📜 Licencia

Este proyecto es de código abierto bajo la licencia MIT.

**Baileys** es mantenido por la comunidad y no está afiliado a WhatsApp Inc.

---

## 🌟 Características

- ✅ Autenticación con código QR (una sola vez, gracias a la persistencia)
- ✅ Envío de mensajes de texto, imágenes, videos, documentos y audio
- ✅ Recepción y registro de mensajes entrantes
- ✅ Respuesta automática (eco-bot básico)
- ✅ API REST para integrar con otros servicios
- ✅ Persistencia de sesión entre reinicios del contenedor
- ✅ Soporte para Node.js 20+ y Docker
- ✅ Logs detallados para depuración

---

## 🛠️ Requisitos

- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/)
- Node.js 20+ (solo para desarrollo local, no necesario en producción)

---

