# Análisis: servicio de notificaciones WhatsApp con Baileys

> **Nota:** este es el análisis inicial (un solo número). El servicio se implementó después con varias sesiones; la documentación vigente está en [README.md](README.md) y [docs/INTEGRACION.md](docs/INTEGRACION.md).

Fecha: 2026-11-12
Servidor: Oracle Cloud (Linux 6.17, 5.8 GB RAM, 4 GB swap)
Proyecto: `/data/docker/whatsapp-baileys`

---

## 1. Resumen

**Recomendación: seguir con Baileys y reducir el proyecto a un servicio que solo envía notificaciones.**

- El servidor anda corto de RAM. Evolution API sumaría entre 300 y 500 MB o más, entre el propio servicio y sus dependencias.
- Los sistemas solo necesitan **enviar** mensajes. No hacen falta chats, bots ni panel.
- La conexión, la sesión persistente y el QR ya funcionan. Se reutilizan.
- Objetivo de consumo: **unos 60–100 MB de RAM**, con un tope duro de **192 MB**.

---

## 2. Estado actual

### 2.1 Servidor

| Recurso | Valor |
|---|---|
| RAM total | 5.9 GB |
| RAM usada | ~2.9 GB |
| RAM disponible (`available`) | ~2.9 GB |
| RAM libre real (`free`) | ~126 MB (el resto es caché) |
| Swap usada | 659 MB de 4 GB |

Ya se está usando swap. Cada MB que se ahorre cuenta.

**Contenedores en ejecución y consumo:**

| Contenedor | RAM |
|---|---|
| n8n-automation | 317 MB |
| saas2026 | 317 MB |
| saas_celery_worker | 149 MB |
| db_postgres | 119 MB |
| saas_celery_beat | 97 MB |
| artehierro | 75 MB |
| datosperson | 65 MB |
| celery_worker_persondata | 19 MB |
| proyectos-nginx-1 | 19 MB |
| n8n-qdrant | 14 MB |
| landings | 8 MB |
| n8n-redis / shared_redis / artehierro_redis | ~13 MB entre los tres |
| certbot_ssl | 6 MB |
| **whatsapp-api** | **no está corriendo** |

### 2.2 Proyecto whatsapp-baileys

| Punto | Estado | Gravedad |
|---|---|---|
| Contenedor | Detenido | Alta |
| Sesión (`session/`) | `creds.json` modificado por última vez el 6 de marzo de 2026. Puede que WhatsApp haya desvinculado el dispositivo | Alta |
| Baileys | Versión `6.7.21`, fijada y desactualizada | Alta |
| Seguridad de la API | `/send`, `/send-all` y `/messages/*` no piden autenticación | **Crítica** |
| Puerto | `3080` publicado en `0.0.0.0` | **Crítica** |
| Fuga de memoria | `incomingMessages` es un arreglo en memoria que crece sin límite con cada mensaje que entra | Alta |
| Código sobrante | SGIA, menús y búsqueda de personas: ~970 de 1704 líneas | Media |
| Sesión acumulada | 277 archivos (112 `pre-key`, 107 `session`, 51 `sender-key`) | Baja |
| Logs | Sin `logger` configurado: Baileys registra en nivel `info` y vuelca cada `connection.update` completo | Media |
| `markOnlineOnConnect: true` | El número aparece "en línea" y el teléfono deja de recibir notificaciones | Baja |
| Dependencias | `node-fetch` sobra (Node 20 trae `fetch`). `git` se queda en la imagen final | Baja |

**Líneas por archivo:**

| Archivo | Líneas | ¿Se queda? |
|---|---|---|
| `src/index.js` | 737 | Solo la conexión, `/status`, `/qr` y el envío (~150 líneas) |
| `src/menuHandlerPersona.js` | 463 | No |
| `src/SGIA.js` | 296 | No |
| `src/menuHandler.js` | 208 | No |

**Endpoints actuales:**

| Endpoint | ¿Se queda? |
|---|---|
| `GET /qr` | Sí, protegido |
| `GET /status` | Sí |
| `POST /send` | Se reemplaza por `POST /notify` |
| `POST /send-all` | Se integra en `/notify` |
| `GET /messages`, `POST /messages/mark-read`, `POST /messages/reply` | No |
| `POST /menu/start`, `GET /menu/list`, `GET /menu/status/:phone` | No |
| `POST /logout` | Sí, protegido |

---

## 3. Baileys o Evolution API

| | Baileys (actual) | Evolution API |
|---|---|---|
| Qué es | Librería de Node; la API la escribes tú | Servidor completo que usa Baileys por dentro |
| RAM estimada | **~60–100 MB** si se configura en modo mínimo | ~300–500 MB o más (más Postgres/Redis si se usan) |
| Contenedores | 1 | 1 a 3 |
| Varios números | Lo programas tú | Incluido (instancias) |
| Panel web y webhooks | No | Sí |
| Integración con n8n | Una petición HTTP | Nodo comunitario y mucha documentación |
| Mantenimiento | Tú actualizas Baileys | Actualizas la imagen Docker |
| Riesgo de baneo | **El mismo**: ninguno es la API oficial de WhatsApp | |

**Evolution API conviene solo si** necesitas:
- varios números (uno por sistema o por cliente del SaaS),
- un panel web para reconectar sin entrar al servidor,
- o recibir mensajes entrantes por webhook.

Ninguna de estas aplica hoy. Si alguna vez hace falta, se puede migrar: el formato de la sesión es el mismo.

---

## 4. Arquitectura propuesta

```
 saas2026 ─────┐
 datosperson ──┤
 artehierro ───┼──► http://whatsapp-notify:8080/notify ──► cola en memoria ──► Baileys ──► WhatsApp
 n8n ──────────┘          (red Docker "repanet",                (1 envío cada 3–5 s)
                           header X-API-Key)
```

- **Sin puerto público.** Todos los contenedores que lo usarían ya están en la red `repanet`, así que basta con conectar `whatsapp-notify` a esa red. No hace falta crear una nueva.
- **Una sola ruta de envío:** `POST /notify`.
- **Cola en memoria con límite de velocidad**, sin Redis (ver sección 6).

### 4.1 API

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `POST` | `/notify` | `X-API-Key` | Encola un mensaje de texto o un documento |
| `GET` | `/status` | No | `{ status, queue, user }` para el healthcheck |
| `GET` | `/qr` | `X-API-Key` | Devuelve el QR en texto si no hay sesión |
| `POST` | `/logout` | `X-API-Key` | Cierra la sesión |

**Ejemplo de `/notify`:**

```json
{
  "to": "593991234567",
  "text": "Pedido #1234 confirmado",
  "document": {
    "base64": "JVBERi0xLjQK...",
    "fileName": "factura-1234.pdf",
    "mimetype": "application/pdf"
  }
}
```

- `to` admite un número o un arreglo de números (reemplaza a `/send-all`).
- `document` es opcional. Límite del body: **5 MB**. Así no se carga un PDF enorme en RAM.
- Respuesta: `202 Accepted` con `{ queued: n, position }`. El envío real ocurre en segundo plano.

### 4.2 Claves de API por sistema (opcional, recomendado)

En vez de una sola clave, una por sistema:

```
API_KEYS=saas:xxxx,persondata:yyyy,artehierro:zzzz,n8n:wwww
```

Así los logs muestran qué sistema envió cada mensaje, y si una clave se filtra se revoca solo esa.

---

## 5. Configuración para consumir lo mínimo

Esta es la parte clave. Por defecto Baileys sincroniza historial, guarda estado y escribe muchos logs. Para un servicio que solo envía, todo eso sobra.

### 5.1 Socket de Baileys

```js
import makeWASocket, { useMultiFileAuthState, DisconnectReason, Browsers } from '@whiskeysockets/baileys';
import pino from 'pino';

const logger = pino({ level: 'warn' });          // 'silent' si quieres aún menos

const sock = makeWASocket({
  auth: state,
  logger,
  browser: Browsers.ubuntu('Notify'),
  markOnlineOnConnect: false,                    // no aparecer "en línea"
  syncFullHistory: false,                        // no descargar historial
  generateHighQualityLinkPreview: false,         // sin previews (evita descargar páginas)
  linkPreviewImageThumbnailWidth: 0,
  fireInitQueries: false,                        // no pedir datos iniciales que no se usan
  emitOwnEvents: false,
  getMessage: async () => undefined,             // no hay store de mensajes
});
```

Reglas:
- **No usar `makeInMemoryStore`.** Es lo que más memoria consume en Baileys.
- **No escuchar `messages.upsert`**, o escucharlo sin guardar nada. Así se elimina la fuga actual de `incomingMessages`.
- **No escuchar** `chats.*`, `contacts.*`, `groups.*` ni `presence.*`.
- **Fijar la versión del protocolo** o llamar a `fetchLatestBaileysVersion()` una sola vez al arrancar, no en cada reconexión.

### 5.2 Node.js

```dockerfile
CMD ["node", "--max-old-space-size=96", "--max-semi-space-size=2", "src/index.js"]
```

- `--max-old-space-size=96` limita el heap de V8 a 96 MB. Node libera memoria antes y no crece "porque puede".
- Arrancar con `node` directamente en lugar de `npm start` ahorra el proceso de npm (~30–40 MB).

### 5.3 Dependencias

| Paquete | Acción |
|---|---|
| `@whiskeysockets/baileys` | Actualizar a 7.x |
| `express` | Mantener, o cambiar a `node:http` nativo (ahorra unos MB) |
| `pino` | Añadir de forma explícita para controlar el nivel de log |
| `qrcode-terminal` | Mantener (es muy pequeño) |
| `dotenv` | Quitar: Docker ya inyecta el `.env` |
| `node-fetch` | Quitar: Node 20 trae `fetch` |
| `jimp`, `sharp`, `link-preview-js` | **No instalar**. Son dependencias opcionales de Baileys para imágenes y previews; no se usan |

Instalar con `npm ci --omit=dev --omit=optional`.

### 5.4 Imagen Docker (multi-stage)

```dockerfile
# --- build ---
FROM node:20-alpine AS build
RUN apk add --no-cache git            # solo si npm lo pide para libsignal
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

# --- runtime ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY src ./src
COPY package.json ./
USER node
EXPOSE 8080
CMD ["node", "--max-old-space-size=96", "--max-semi-space-size=2", "src/index.js"]
```

- `git` no queda en la imagen final.
- Corre como usuario `node`, no como root.
- Solo se copia `src/`. Los README y SGIA no entran en la imagen.

### 5.5 docker-compose

```yaml
services:
  whatsapp-notify:
    build: .
    container_name: whatsapp-notify
    env_file: .env
    volumes:
      - ./session:/app/session
    environment:
      - SESSION_DIR=/app/session
    networks:
      - repanet
    # sin "ports:" → no se expone a internet
    mem_limit: 192m
    memswap_limit: 256m
    cpus: 0.5
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "5m"
        max-file: "2"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/status"]
      interval: 60s
      timeout: 5s
      retries: 3

networks:
  repanet:
    external: true
```

- `mem_limit: 192m`: si algo falla y la memoria se dispara, Docker reinicia solo este contenedor en lugar de afectar a Postgres o n8n.
- Logs limitados a 10 MB en total.
- Healthcheck cada 60 s, no cada 10 s.

### 5.6 Limpieza de la sesión

La carpeta `session/` tiene 277 archivos y crece con el tiempo (pre-keys y sesiones de cada contacto). No consume RAM, pero sí disco e inodos, y hace más lento el arranque.

- Si toca escanear el QR otra vez, **empezar con una carpeta vacía** (guardar la anterior como respaldo).
- Más adelante se puede añadir una limpieza mensual de archivos `session-*` y `sender-key-*` con más de 90 días.

### 5.7 Consumo estimado

| Configuración | RAM estimada |
|---|---|
| Actual (`npm start`, sin logger, con menús y buffer de mensajes) | 130–200 MB, y crece con el tiempo |
| Propuesta (modo mínimo) | **~60–100 MB**, estable |
| Evolution API (como referencia) | 300–500 MB o más |

*Son estimaciones. Hay que medirlo con `docker stats` después del despliegue.*

---

## 6. Cola y límite de envíos

**Cola en memoria, no Redis.** Existe `shared_redis`, pero:
- añade una dependencia (`ioredis`, ~2–3 MB más de RAM) y un punto de falla más;
- con el volumen de notificaciones de estos sistemas, una cola en memoria basta.

Lo que se pierde: si el contenedor se reinicia, se pierden los mensajes que estaban en cola. Para notificaciones es aceptable. Si alguna vez no lo es, se cambia a Redis sin tocar la API.

Reglas de la cola:

| Regla | Valor sugerido | Motivo |
|---|---|---|
| Intervalo entre envíos | 3–5 s con un poco de azar | Envíos a ritmo constante parecen bot y facilitan el baneo |
| Tamaño máximo de la cola | 200 mensajes | Si un sistema entra en bucle, se rechaza con `429` en vez de llenar la RAM |
| Máximo por destinatario | 5 por minuto | Evita que un error mande 50 mensajes a la misma persona |
| Reintentos | 2, con espera creciente | Por cortes momentáneos |
| Si no hay conexión | Mantener en cola; si el estado es `logged_out`, rechazar con `503` | |

---

## 7. Seguridad

1. **Quitar `ports: 3080:8080`.** Es lo más urgente. Hoy cualquiera que llegue al puerto puede enviar mensajes desde tu número.
2. **Revisar la Security List / NSG de Oracle** y cerrar el 3080 también allí.
3. **API key obligatoria** en `/notify`, `/qr` y `/logout`. Compararla con `crypto.timingSafeEqual`.
4. **Validar `to`**: solo dígitos, entre 10 y 15 caracteres.
5. **No registrar el contenido** de los mensajes en los logs, solo el destino y el resultado.
6. **Usar un número secundario** solo para notificaciones. Si WhatsApp lo banea, no pierdes tu número personal.
7. Si `/qr` se necesita desde fuera, publicarlo a través de nginx con autenticación, nunca abriendo el puerto.

---

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Baneo del número | Número secundario, límite de envíos, enviar solo a quien espera el mensaje, no enviar publicidad masiva |
| WhatsApp cambia el protocolo | Actualizar Baileys cada 1–2 meses; revisar los logs si deja de enviar |
| Sesión desvinculada sin que nadie lo note | Aviso automático (sección 9) |
| Baileys 7 cambia la API | Ver sección 10 |
| Pérdida de la cola al reiniciar | Aceptado para notificaciones; los sistemas pueden reintentar si reciben un error |

---

## 9. Aviso cuando se cae la sesión (opcional)

Cuando `connection.update` llega con `DisconnectReason.loggedOut`:
- llamar a un webhook de n8n (`ALERT_WEBHOOK_URL`) que te mande un correo o un Telegram;
- poner el estado en `logged_out` para que `/notify` responda `503` y los sistemas lo sepan.

No hace falta panel. Con el aviso basta para saber que hay que escanear el QR.

---

## 10. Migración a Baileys 7.x

Cambios a tener en cuenta (revisar las notas de la versión antes de actualizar):
- El paquete pasa a **ESM**: `import` en lugar de `require`, y `"type": "module"` en `package.json`.
- Aparecen los **LID** (identificadores que no son el número de teléfono) en eventos y mensajes. Para un servicio que solo envía a números conocidos (`<numero>@s.whatsapp.net`) el impacto es mínimo.
- Algunas opciones del socket cambian de nombre o se eliminan. Hay que revisarlas con el changelog.

Como el código nuevo es pequeño (~150–200 líneas), es más simple **reescribir `src/index.js`** que migrar el actual.

---

## 11. Plan de trabajo

| # | Paso | Esfuerzo |
|---|---|---|
| 1 | Respaldar `session/` y crear una rama `notify-service` | 5 min |
| 2 | Borrar `SGIA.js`, `menuHandler.js`, `menuHandlerPersona.js` y `SGIA_README.md` | 5 min |
| 3 | Reescribir `src/index.js`: conexión mínima, `/notify`, `/status`, `/qr`, `/logout`, cola y API key | 1–2 h |
| 4 | Actualizar `package.json` (Baileys 7, `pino`, quitar `dotenv` y `node-fetch`) | 10 min |
| 5 | Dockerfile multi-stage y nuevo `docker-compose.yml` (red `repanet`, sin puertos, límites) | 20 min |
| 6 | Cerrar el puerto 3080 en Oracle | 5 min |
| 7 | Levantar el contenedor y escanear el QR con el número secundario | 10 min |
| 8 | Probar desde n8n: `http://whatsapp-notify:8080/notify` | 15 min |
| 9 | Cambiar saas, persondata y artehierro para que usen `/notify` | Depende de cada sistema |
| 10 | Medir con `docker stats` durante unos días y ajustar `mem_limit` | — |
| 11 | (Opcional) Aviso de sesión caída por n8n | 30 min |

---

## 12. Variables de entorno (`.env.example` propuesto)

```env
SESSION_DIR=/app/session
PORT=8080

# Claves por sistema: nombre:clave separados por coma
API_KEYS=saas:cambiar,persondata:cambiar,artehierro:cambiar,n8n:cambiar

# Cola
SEND_INTERVAL_MS=4000
QUEUE_MAX=200
PER_RECIPIENT_PER_MIN=5

# Log: warn | error | silent
LOG_LEVEL=warn

# Opcional: webhook de n8n para avisar si se cae la sesión
ALERT_WEBHOOK_URL=
```

Se eliminan `URL_API_N8N` y `AUTHORIZATION_N8N`, que solo usaba la búsqueda de personas.
