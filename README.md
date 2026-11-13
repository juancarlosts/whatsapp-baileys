# whatsapp-notify

Servicio mínimo para enviar notificaciones por WhatsApp desde los demás sistemas del servidor. Usa [Baileys](https://github.com/WhiskeySockets/Baileys) y maneja **varias sesiones**: cada sesión es un número de WhatsApp con su propia cola, sus límites y su configuración.

- Sin puerto público: solo se accede por la red Docker `repanet`, en `http://whatsapp-notify:8080`.
- Cada sistema usa su propia clave (`X-API-Key`), limitada a las sesiones que le corresponden.
- Los envíos pasan por una cola en memoria con pausas entre mensajes.
- Una sesión puede reenviar los mensajes entrantes a un webhook (para un asistente).
- Consumo: unos 37 MB con una sesión conectada; límite del contenedor en 320 MB.

Cómo usarlo desde Django y n8n: [docs/INTEGRACION.md](docs/INTEGRACION.md).

## Sesiones actuales

| Sesión | Uso | Estado |
|---|---|---|
| `sistema` | Notificaciones internas (persondata, artehierro, alertas) | Vinculada |
| `gualasoft` | Avisos del SaaS a sus clientes y asistente de ventas | Creada, falta vincular el número |
| `cliente-<id>` | Notificaciones de cada cliente del SaaS a sus clientes | Las crea el SaaS |

## Puesta en marcha

```bash
cp .env.example .env        # y poner claves reales: openssl rand -hex 24
docker compose up -d --build
```

Las sesiones se guardan en `./session/<id>/` y su configuración en `./session/<id>.json`. Al arrancar se reconectan solas las que tienen un número vinculado.

### Vincular un número desde la terminal

```bash
KEY=$(grep -o 'saas:[a-f0-9]*' .env | cut -d: -f2)
docker exec whatsapp-notify wget -qO- --header "X-API-Key: $KEY" \
  "http://127.0.0.1:8080/sessions/gualasoft/qr?format=text"
```

Escanear en el teléfono: WhatsApp → Dispositivos vinculados → Vincular un dispositivo. El QR cambia cada ~20 s y caduca en un par de minutos; si caduca, se vuelve a pedir.

## Claves y permisos

`API_KEYS` es una lista `nombre:clave:alcance` separada por comas.

| Alcance | Significado |
|---|---|
| `*` | Administrador: usa todas las sesiones y puede crearlas y eliminarlas |
| `sistema` | Solo esa sesión |
| `sistema\|gualasoft` | Varias sesiones |
| `cliente-*` | Todas las que empiezan por `cliente-` |

Configuración actual:

| Clave | Alcance |
|---|---|
| `saas` | `*` |
| `persondata` | `sistema` |
| `artehierro` | `sistema` |
| `n8n` | `sistema\|gualasoft` |

## API

Todas las rutas bajo `/sessions` piden el header `X-API-Key`.

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| `GET` | `/status` | Ninguno | Salud del servicio: `{ ok, sessions, connected }` |
| `GET` | `/sessions` | Clave | Lista las sesiones que la clave puede usar |
| `PUT` | `/sessions/<id>` | Admin | Crea la sesión o cambia su configuración |
| `GET` | `/sessions/<id>` | Clave | Estado de la sesión |
| `DELETE` | `/sessions/<id>` | Admin | Desvincula el número y elimina la sesión |
| `GET` | `/sessions/<id>/qr` | Clave | QR para vincular (`?format=text` lo dibuja) |
| `POST` | `/sessions/<id>/notify` | Clave | Encola un mensaje |
| `POST` | `/sessions/<id>/logout` | Clave | Desvincula el número y conserva la sesión |

El `<id>` admite minúsculas, números, `-` y `_` (máximo 40 caracteres).

### PUT /sessions/\<id\>

```json
{ "dailyLimit": 300, "webhook": "http://n8n-automation:5678/webhook/asistente" }
```

| Campo | Por defecto | Descripción |
|---|---|---|
| `dailyLimit` | `0` | Máximo de mensajes por día (UTC). `0` = sin límite |
| `webhook` | `null` | URL que recibe los mensajes entrantes. `null` = se ignoran |

Los campos que no se envían no cambian.

### GET /sessions/\<id\>

```json
{
  "id": "sistema",
  "status": "connected",
  "number": "593967964924",
  "pending": 0,
  "sentToday": 2,
  "dailyLimit": 0,
  "webhook": null
}
```

| `status` | Significado |
|---|---|
| `unlinked` | Sin número vinculado; hay que pedir el QR |
| `qr` | QR generado, esperando que lo escaneen |
| `connecting` | Abriendo la conexión |
| `connected` | Lista para enviar |
| `disconnected` | Conexión caída; reintenta sola |

### GET /sessions/\<id\>/qr

```json
{ "status": "qr", "qr": "https://wa.me/settings/linked_devices#2@..." }
```

`qr` es el texto que hay que dibujar como código QR. Si la sesión ya está conectada, devuelve `{ "status": "connected", "qr": null }`. La conexión para vincular solo se abre cuando alguien pide el QR, así que una sesión sin vincular no gasta recursos.

### POST /sessions/\<id\>/notify

```bash
curl -X POST http://whatsapp-notify:8080/sessions/sistema/notify \
  -H "X-API-Key: <clave>" -H "Content-Type: application/json" \
  -d '{"to": "593991234567", "text": "Pedido #1234 confirmado"}'
```

| Campo | Descripción |
|---|---|
| `to` | Número con código de país, solo dígitos. Admite una lista. También acepta el `from` de un mensaje entrante |
| `text` | Texto del mensaje (o descripción del documento) |
| `document` | Opcional: `{ "base64": "...", "fileName": "factura.pdf", "mimetype": "application/pdf" }` |

Hace falta `text`, `document` o ambos. El cuerpo no puede pasar de 5 MB.

| Código | Significado |
|---|---|
| `202` | Encolado: `{ "queued": 1, "pending": 1, "status": "connected" }` |
| `400` | Datos inválidos |
| `401` | Falta la clave o es incorrecta |
| `403` | La clave no puede usar esa sesión |
| `404` | La sesión no existe |
| `409` | La sesión no tiene número vinculado |
| `429` | Cola llena, límite diario o demasiados mensajes al mismo número |

`202` significa que el mensaje entró en la cola, no que ya se entregó. Si la conexión está caída, la cola espera a que vuelva. La cola y el contador diario viven en memoria: se pierden si el contenedor se reinicia.

### Mensajes entrantes (webhook)

Si la sesión tiene `webhook`, cada mensaje de texto que llega de un chat individual se reenvía con un `POST`:

```json
{
  "session": "gualasoft",
  "from": "593991234567@s.whatsapp.net",
  "number": "593991234567",
  "name": "María",
  "text": "Hola, quiero información",
  "id": "3EB0C767D26A1B2E5F",
  "timestamp": 1794528000
}
```

- Para responder, usa `from` tal cual como `to` en `/notify`.
- `number` puede venir en `null`: WhatsApp a veces oculta el número y entrega un identificador que termina en `@lid`.
- No se reenvían grupos, estados, audios ni imágenes sin texto.
- Si `WEBHOOK_TOKEN` está definido, se envía en el header `X-Webhook-Token` para que el receptor verifique el origen.
- No hay reintentos: si el webhook falla, el mensaje se pierde (queda una línea en el log).

## Configuración (`.env`)

| Variable | Por defecto | Descripción |
|---|---|---|
| `API_KEYS` | (obligatoria) | `nombre:clave:alcance,...` |
| `MAX_SESSIONS` | `10` | Máximo de sesiones |
| `SEND_INTERVAL_MS` | `4000` | Pausa media entre envíos de una sesión |
| `QUEUE_MAX` | `200` | Máximo de mensajes en cola por sesión |
| `QUEUE_MAX_MB` | `20` | Máximo de MB en documentos entre todas las colas |
| `PER_RECIPIENT_PER_MIN` | `5` | Máximo de mensajes por número y minuto |
| `LOG_LEVEL` | `warn` | Log de Baileys: `warn`, `error` o `silent` |
| `ALERT_WEBHOOK_URL` | (vacío) | Recibe `{"session":"...","event":"logged_out"}` si WhatsApp cierra una sesión |
| `WEBHOOK_TOKEN` | (vacío) | Se envía como `X-Webhook-Token` en todos los webhooks |

## Recursos

Cada sesión conectada suma memoria. Al subir `MAX_SESSIONS`, hay que subir también `mem_limit` en [docker-compose.yml](docker-compose.yml) y `--max-old-space-size` en el [Dockerfile](Dockerfile). Conviene medir con `docker stats` al vincular los primeros números antes de decidir cuántos caben.

## Operación

```bash
docker logs --tail 50 whatsapp-notify          # envíos y errores, con la sesión entre corchetes
docker stats --no-stream whatsapp-notify       # consumo
docker exec whatsapp-notify wget -qO- http://127.0.0.1:8080/status
```

Para actualizar Baileys: cambiar la versión en `package.json`, regenerar el lockfile y reconstruir.

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/w -w /w node:20-alpine \
  npm install --package-lock-only --omit=dev
docker compose up -d --build
```

## Aviso

Baileys no es la API oficial de WhatsApp y cualquier número vinculado puede ser bloqueado. Usa números dedicados, envía solo a quien espera el mensaje y no lo uses para campañas masivas.
