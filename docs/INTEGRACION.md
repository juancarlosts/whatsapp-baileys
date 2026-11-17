# Guía de integración con whatsapp-notify

Cómo enviar WhatsApp desde saas, persondata, artehierro y n8n. La referencia completa de la API está en el [README](../README.md).

## 1. Qué número usa cada cosa

| Uso | Sesión | Quién la usa |
|---|---|---|
| Notificaciones internas y alertas | `sistema` | persondata, artehierro, n8n |
| Avisos de GualaSoft a los clientes del SaaS (facturas, vencimientos) | `gualasoft` | saas, n8n |
| Asistente de ventas de GualaSoft | `gualasoft` (con webhook) | n8n |
| Notificaciones de un cliente del SaaS a sus propios clientes | `cliente-<id>` | saas |

Reglas:

- **Nunca** enviar a los clientes de un cliente desde `gualasoft` o `sistema`. Cada cliente usa su propio número.
- No enviar ofertas masivas por aquí. Los mensajes promocionales a quien no escribió primero son la causa principal de bloqueo.
- El formato del número es código de país + número, solo dígitos: `0991234567` → `593991234567`.

## 2. Variables de entorno en cada proyecto

```env
WHATSAPP_NOTIFY_URL=http://whatsapp-notify:8080
WHATSAPP_NOTIFY_KEY=<la clave de ese proyecto>
```

Las claves están en `/data/docker/whatsapp-baileys/.env`, en `API_KEYS`. Cada proyecto usa la suya; no compartas la de `saas`, que es de administrador.

Los tres proyectos ya están en la red Docker `repanet`, así que el nombre `whatsapp-notify` resuelve sin cambios de red.

## 3. Cliente para Django

Usa solo la librería estándar de Python. Copiar como `whatsapp.py` en una app común de cada proyecto.

```python
"""Cliente de whatsapp-notify."""
import base64
import json
import logging
import os
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)

BASE_URL = os.environ.get("WHATSAPP_NOTIFY_URL", "http://whatsapp-notify:8080")
API_KEY = os.environ.get("WHATSAPP_NOTIFY_KEY", "")


class WhatsAppError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def _request(method, path, payload=None, timeout=15):
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        try:
            message = json.loads(exc.read()).get("error", str(exc))
        except ValueError:
            message = str(exc)
        raise WhatsAppError(exc.code, message) from None
    except OSError as exc:  # servicio caído o sin red
        raise WhatsAppError(503, str(exc)) from None


def enviar_whatsapp(numero, texto="", archivo=None, nombre_archivo=None,
                    mimetype="application/pdf", sesion="sistema"):
    """Encola un mensaje. `numero`: código de país + número, o una lista.
    `archivo`: bytes opcionales (máx. ~3.5 MB).
    Devuelve True si se encoló; nunca lanza excepción."""
    payload = {"to": numero, "text": texto}
    if archivo:
        payload["document"] = {
            "base64": base64.b64encode(archivo).decode(),
            "fileName": nombre_archivo or "documento.pdf",
            "mimetype": mimetype,
        }
    try:
        _request("POST", f"/sessions/{sesion}/notify", payload)
        return True
    except WhatsAppError as exc:
        logger.warning("WhatsApp no enviado a %s por %s: %s", numero, sesion, exc)
        return False


# --- Administración de sesiones (solo con la clave de administrador) ---

def crear_sesion(sesion, limite_diario=0, webhook=None):
    return _request("PUT", f"/sessions/{sesion}", {"dailyLimit": limite_diario, "webhook": webhook})


def estado_sesion(sesion):
    return _request("GET", f"/sessions/{sesion}")


def qr_sesion(sesion):
    """Devuelve {"status": ..., "qr": texto o None}."""
    return _request("GET", f"/sessions/{sesion}/qr")


def desvincular_sesion(sesion):
    return _request("POST", f"/sessions/{sesion}/logout")


def eliminar_sesion(sesion):
    return _request("DELETE", f"/sessions/{sesion}")
```

### Uso

```python
from core.whatsapp import enviar_whatsapp

# Texto por el número del sistema
enviar_whatsapp("593991234567", "Tu consulta está lista ✅")

# Varios destinatarios
enviar_whatsapp(["593991234567", "593987654321"], "Recordatorio de pago")

# PDF desde el número de GualaSoft
with open("/ruta/factura.pdf", "rb") as f:
    enviar_whatsapp("593991234567", "Adjunto tu factura", f.read(),
                    "factura-1234.pdf", sesion="gualasoft")
```

`True` significa que el mensaje entró en la cola, no que se entregó. Sale unos segundos después, uno cada ~4 s por sesión.

### Con Celery (saas y persondata)

Para no frenar la respuesta al usuario:

```python
from celery import shared_task
from core.whatsapp import enviar_whatsapp

@shared_task(ignore_result=True)
def notificar_whatsapp(numero, texto, sesion="sistema"):
    enviar_whatsapp(numero, texto, sesion=sesion)

notificar_whatsapp.delay("593991234567", "Hola")
```

## 4. Por proyecto

### persondata y artehierro

Solo envían por `sistema`. Basta con las variables de entorno, el cliente y llamar a `enviar_whatsapp(...)` donde haga falta.

### saas: avisos de GualaSoft

Igual, pero con `sesion="gualasoft"`. Antes hay que vincular el número de GualaSoft (ver "Vincular un número desde la terminal" en el README).

### saas: "Conectar WhatsApp" para cada cliente

El id de la sesión de un cliente es `cliente-<id del tenant>`, por ejemplo `cliente-12`.

Flujo en el panel del cliente:

1. **Conectar.** El cliente pulsa "Conectar WhatsApp". La vista llama a `crear_sesion(f"cliente-{tenant.id}", limite_diario=<según su plan>)`. Es seguro llamarla aunque la sesión ya exista.
2. **Mostrar el QR.** La página consulta cada 3–5 s una vista que devuelve `qr_sesion(...)`:
   - `status == "qr"`: dibujar `qr` como código QR. Cambia cada ~20 s, por eso hay que refrescar.
   - `status == "connected"`: mostrar "Conectado" y dejar de consultar.
   - `status == "unlinked"`: el QR caducó; la siguiente consulta genera otro.
3. **Enviar.** `enviar_whatsapp(numero, texto, sesion=f"cliente-{tenant.id}")`.
4. **Estado.** Mostrar `estado_sesion(...)` en el panel: `status`, `number` y `sentToday`/`dailyLimit`.
5. **Desconectar.** `desvincular_sesion(...)` para cambiar de número, o `eliminar_sesion(...)` si el cliente se da de baja.

Vista de ejemplo para el QR:

```python
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from core.whatsapp import WhatsAppError, crear_sesion, qr_sesion


@login_required
def whatsapp_qr(request):
    sesion = f"cliente-{request.tenant.id}"   # ajustar a cómo obtienes el tenant
    try:
        crear_sesion(sesion, limite_diario=200)
        return JsonResponse(qr_sesion(sesion))
    except WhatsAppError as exc:
        return JsonResponse({"error": str(exc)}, status=exc.status)
```

Para dibujar el QR en el navegador sirve cualquier librería de QR en JavaScript, o generarlo en Django con el paquete `qrcode` y devolver la imagen.

Puntos a cuidar:

- **El id de la sesión lo decide el servidor**, nunca un dato que mande el navegador. Si no, un cliente podría usar el WhatsApp de otro.
- **Límite de sesiones.** `MAX_SESSIONS` vale 10. Si se alcanza, `crear_sesion` responde 409; el panel debe mostrar un mensaje claro.
- **Sesiones caídas.** Si el teléfono del cliente pasa unas dos semanas sin conexión, o el cliente quita el dispositivo, la sesión vuelve a `unlinked` y `enviar_whatsapp` devuelve `False` (409). Conviene avisar al cliente; ver el punto 6.
- **Términos de servicio.** Dejar claro al cliente que es una conexión no oficial y que WhatsApp puede bloquear su número si envía mensajes no deseados.

## 5. n8n

### Enviar

Nodo **HTTP Request**:

- **Método y URL:** `POST` a `http://whatsapp-notify:8080/sessions/sistema/notify`
- **Header:** `X-API-Key` con la clave de `n8n`
- **Body JSON:** `{"to": "593991234567", "text": "Hola"}`

La clave de `n8n` puede usar `sistema` y `gualasoft`.

### Asistente de ventas (número GualaSoft)

1. En n8n, crear un flujo con un nodo **Webhook** (`POST`). Usar la URL interna, por ejemplo `http://n8n-automation:5678/webhook/asistente-ventas`.
2. Activar el reenvío de entrantes en la sesión (con la clave de administrador):

   ```bash
   KEY=$(grep -o 'saas:[a-f0-9]*' /data/docker/whatsapp-baileys/.env | cut -d: -f2)
   docker run --rm --network repanet curlimages/curl -s -X PUT \
     -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
     -d '{"webhook":"http://n8n-automation:5678/webhook/asistente-ventas"}' \
     http://whatsapp-notify:8080/sessions/gualasoft
   ```

3. El flujo recibe `{session, from, number, name, text, id, timestamp}`, genera la respuesta (agente de IA, Qdrant, etc.) y la envía con un **HTTP Request** a `/sessions/gualasoft/notify` usando `{"to": "{{ $json.body.from }}", "text": "<respuesta>"}`.

Recomendaciones:

- Responder con `from`, no con `number`: `number` puede venir vacío.
- Definir `WEBHOOK_TOKEN` en el `.env` de whatsapp-notify y comprobar el header `X-Webhook-Token` en el flujo.
- Guardar el historial por `from` en n8n si el asistente necesita memoria; whatsapp-notify no guarda mensajes.
- Para quitar el asistente: el mismo `PUT` con `{"webhook": null}`.

## 6. Aviso de sesiones caídas

Con `ALERT_WEBHOOK_URL` definido, cuando WhatsApp cierra una sesión el servicio envía:

```json
{ "session": "cliente-12", "event": "logged_out", "at": "2026-11-13T00:00:00.000Z" }
```

Un flujo de n8n puede avisarte por correo si es `sistema` o `gualasoft`, y avisar al cliente si es `cliente-<id>`.

## 7. Límites a tener en cuenta

| Límite | Valor | Qué pasa al superarlo |
|---|---|---|
| Mensajes al mismo número | 5 por minuto | `429` |
| Mensajes en cola por sesión | 200 | `429` |
| Mensajes por día de una sesión | `dailyLimit` (0 = 500), menos durante las 4 semanas de calentamiento: 30, 60, 120, 240 | `429` |
| Mensajes por hora de una sesión | Un cuarto del límite diario (mínimo 10) | `429` |
| Chats nuevos por día | La mitad del límite diario, máximo 100 | `429` |
| Tamaño del cuerpo | 5 MB (documento de ~3.5 MB) | `413` |
| Sesiones | 10 | `409` al crear |

Las respuestas a quien escribió en las últimas 24 h no consumen estos límites. Los límites vigentes de cada sesión se ven en `estado_sesion(...)`; el detalle está en el [README](../README.md#límites-contra-el-bloqueo).

La cola está en memoria: si el contenedor se reinicia, los mensajes pendientes se pierden. Los contadores sí se conservan.

## 8. Orden sugerido

1. Integrar persondata y artehierro con `sistema`.
2. Vincular el número de GualaSoft e integrar los avisos del SaaS.
3. Montar el asistente de ventas en n8n.
4. Añadir "Conectar WhatsApp" al SaaS y probar con uno o dos clientes.
5. Medir memoria con `docker stats` y ajustar `MAX_SESSIONS`.
