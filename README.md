# whatsapp-notify

Servicio mínimo para enviar notificaciones por WhatsApp desde los demás sistemas del servidor. Usa [Baileys](https://github.com/WhiskeySockets/Baileys) y solo envía: no guarda ni responde mensajes entrantes.

- Sin puerto público: solo se accede por la red Docker `repanet`, en `http://whatsapp-notify:8080`.
- Cada sistema usa su propia clave en el header `X-API-Key`.
- Los envíos pasan por una cola en memoria con pausas entre mensajes.
- Límite de 192 MB de RAM (usa unos 40 MB en reposo).

## Puesta en marcha

```bash
cp .env.example .env        # y poner claves reales: openssl rand -hex 24
docker compose up -d --build
docker logs -f whatsapp-notify   # muestra el QR para vincular el número
```

En el teléfono: WhatsApp → Dispositivos vinculados → Vincular un dispositivo. La sesión queda guardada en `./session`.

## API

| Método | Ruta | Clave | Descripción |
|---|---|---|---|
| `POST` | `/notify` | Sí | Encola un mensaje |
| `GET` | `/status` | No | Estado de la conexión y mensajes pendientes |
| `GET` | `/qr` | Sí | QR en texto, si hay que vincular |
| `POST` | `/logout` | Sí | Cierra la sesión y genera un QR nuevo |

### POST /notify

```bash
curl -X POST http://whatsapp-notify:8080/notify \
  -H "X-API-Key: <clave>" -H "Content-Type: application/json" \
  -d '{"to": "593991234567", "text": "Pedido #1234 confirmado"}'
```

| Campo | Descripción |
|---|---|
| `to` | Número con código de país, solo dígitos. También admite una lista |
| `text` | Texto del mensaje (o descripción del documento) |
| `document` | Opcional: `{ "base64": "...", "fileName": "factura.pdf", "mimetype": "application/pdf" }` |

Hace falta `text`, `document` o ambos. El cuerpo no puede pasar de 5 MB.

Respuestas:

| Código | Significado |
|---|---|
| `202` | Encolado: `{ "queued": 1, "pending": 1, "status": "connected" }` |
| `400` | Datos inválidos |
| `401` | Falta la clave o es incorrecta |
| `429` | Cola llena o demasiados mensajes al mismo número |

`202` significa que el mensaje entró en la cola, no que ya se entregó. Si WhatsApp está desconectado, la cola espera a que vuelva. La cola vive en memoria: se pierde si el contenedor se reinicia.

### GET /status

```json
{ "status": "connected", "pending": 0 }
```

`status` puede ser `connecting`, `qr` (falta escanear), `connected` o `disconnected`.

## Configuración (`.env`)

| Variable | Por defecto | Descripción |
|---|---|---|
| `API_KEYS` | (obligatoria) | `sistema:clave,otro:clave` |
| `SEND_INTERVAL_MS` | `4000` | Pausa media entre envíos |
| `QUEUE_MAX` | `200` | Máximo de mensajes en cola |
| `QUEUE_MAX_MB` | `20` | Máximo de MB en documentos en cola |
| `PER_RECIPIENT_PER_MIN` | `5` | Máximo de mensajes por número y minuto |
| `LOG_LEVEL` | `warn` | Log de Baileys: `warn`, `error` o `silent` |
| `ALERT_WEBHOOK_URL` | (vacío) | Recibe un `POST` con `{"event":"logged_out"}` si WhatsApp cierra la sesión |

## Operación

```bash
docker logs --tail 50 whatsapp-notify          # ver envíos y errores
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

Baileys no es la API oficial de WhatsApp y el número puede ser bloqueado. Usa un número dedicado a notificaciones y envía solo a quien espera el mensaje.
