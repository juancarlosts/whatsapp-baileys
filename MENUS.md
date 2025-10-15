# 📋 Sistema de Menús Interactivos

Sistema de menús automático para WhatsApp con soporte para múltiples niveles, timeouts y navegación.

## 🎯 Características

- ✅ Menús multinivel con navegación
- ✅ Timeout automático (60 segundos)
- ✅ Estado de conversación por usuario
- ✅ Respuestas automáticas configurables
- ✅ Fácil de personalizar y extender
- ✅ No interfiere con el sistema de mensajes existente

## 📱 Uso Automático

El sistema se activa automáticamente cuando:

1. **Usuario escribe "Hola" o "Buenos días"** → Muestra menú de cliente
2. **Usuario escribe "Menú"** → Muestra menú principal
3. **Usuario está en un menú activo** → Procesa la opción seleccionada

## 🔧 API Endpoints

### Iniciar menú manualmente

```bash
POST /menu/start
```

**Body:**
```json
{
  "to": "593995707647",
  "menuId": "MAIN"
}
```

**Menús disponibles:**
- `CLIENTE` - Menú de bienvenida (¿Eres cliente?)
- `MAIN` - Menú principal
- `SOPORTE` - Menú de soporte técnico
- `PRODUCTOS` - Catálogo de productos
- `FACTURAS` - Gestión de facturas

### Listar menús disponibles

```bash
GET /menu/list
```

### Ver estado del menú de un usuario

```bash
GET /menu/status/593995707647
```

### Limpiar estado del menú

```bash
DELETE /menu/clear/593995707647
```

## 🎨 Personalizar Menús

Edita el archivo `src/menuHandler.js` y modifica el objeto `MENUS`:

```javascript
MENUS: {
    TU_MENU: {
        id: 'TU_MENU',
        title: '🎉 *Título del Menú*',
        message: 'Descripción y opciones...',
        options: {
            '1': { 
                action: 'ACCION_1', 
                response: 'Respuesta al usuario',
                nextMenu: 'OTRO_MENU' // Opcional
            },
            '0': { 
                action: 'BACK', 
                nextMenu: 'MAIN' 
            },
        },
        timeout: true // Habilitar timeout de 60 segundos
    }
}
```

## 🔄 Flujo de Navegación

```
Usuario: "Hola"
  ↓
Bot: Menú CLIENTE
  ↓
Usuario: "1" (Soy cliente)
  ↓
Bot: Menú MAIN
  ↓
Usuario: "1" (Soporte)
  ↓
Bot: Menú SOPORTE
  ↓
Usuario: "3" (Hablar con agente)
  ↓
Bot: "Un agente te contactará..."
```

## ⏱️ Timeout

Después de 60 segundos sin respuesta:
- El estado del menú se limpia automáticamente
- El usuario debe escribir "Menú" para volver a empezar

## 🧪 Ejemplos de Uso

### Ejemplo 1: Iniciar menú de cliente

```bash
curl -X POST http://localhost:3080/menu/start \
  -H "Content-Type: application/json" \
  -d '{
    "to": "593995707647",
    "menuId": "CLIENTE"
  }'
```

### Ejemplo 2: Ver estado del menú

```bash
curl http://localhost:3080/menu/status/593995707647
```

**Respuesta:**
```json
{
  "phoneNumber": "593995707647",
  "isActive": true,
  "currentMenu": {
    "id": "SOPORTE",
    "title": "🆘 *Soporte Técnico*"
  }
}
```

### Ejemplo 3: Limpiar estado

```bash
curl -X DELETE http://localhost:3080/menu/clear/593995707647
```

## 📝 Notas Importantes

1. **Los menús NO interfieren con el sistema de mensajes**: Los mensajes se siguen guardando normalmente
2. **Solo funciona con mensajes de texto**: Imágenes, videos, etc. se ignoran
3. **Estado en memoria**: Se pierde al reiniciar el contenedor
4. **Case-insensitive**: "menu", "Menu", "MENU" funcionan igual

## 🎯 Casos de Uso

### Soporte al cliente
```
Menu → Soporte → Problema técnico → Agente humano
```

### Ventas
```
Menu → Productos → Catálogo → Compra
```

### Información
```
Hola → ¿Eres cliente? → No → Información de contacto
```

## 🔐 Desactivar Menús Automáticos

Si quieres desactivar las respuestas automáticas, comenta estas líneas en `index.js`:

```javascript
// Sistema de menús automático (solo para mensajes de texto)
// ... código del menú ...
```

El sistema seguirá funcionando vía API endpoints.
