# 🔍 Sistema de Búsqueda de Personas - WhatsApp Bot

Sistema interactivo de búsqueda de personas integrado con APIs externas para consultas por nombre y cédula.

## ✅ Estado del Sistema

El sistema está **funcionando correctamente** y listo para usar.

## 🚀 Características

- ✅ Búsqueda por **Nombre** (API Nombres)
- ✅ Búsqueda por **Cédula** (API Colmena)
- ✅ Validación de cédulas ecuatorianas (10 dígitos)
- ✅ Menú interactivo por WhatsApp
- ✅ Timeout automático de 2 minutos
- ✅ Manejo de múltiples resultados
- ✅ Formato limpio de respuestas
- ✅ Logs detallados para debugging

## 📋 Requisitos

### Dependencias instaladas:
```json
{
  "@whiskeysockets/baileys": "6.7.20",
  "dotenv": "^16.4.5",
  "express": "^4.18.2",
  "node-fetch": "^2.7.0",
  "qrcode-terminal": "^0.12.0"
}
```

### Variables de entorno (.env):
```properties
# Autenticación API Colmena (búsqueda por cédula)
AUTHORIZATION=SlVBTiAgVUxMT0EyNA==
URL=https://datos.los4rios.com/api_basico/

# Autenticación API Nombres (búsqueda por nombre)
AUTHORIZATION_NOMBRES=Tk9NQlJFUyBKQzEyNg==
URL_NOMBRES=https://datos.los4rios.com/api_busca_nombres/
```

## 🎯 Cómo Usar

### 1. Iniciar el Sistema

El bot escucha automáticamente los mensajes entrantes. Para iniciar una búsqueda:

**Envía por WhatsApp:**
```
menu
```
o
```
menú
```

### 2. Menú Principal

Recibirás el siguiente menú:

```
🔍 *Búsqueda de Personas*

Bienvenido al sistema de búsqueda.

¿Cómo deseas buscar?

1️⃣ Buscar por Nombre
2️⃣ Buscar por Cédula
0️⃣ Salir

_Escribe el número de tu opción_
```

### 3. Búsqueda por Nombre

**Paso 1:** Escribe `1`

**Paso 2:** El sistema te pedirá el nombre:
```
👤 *Búsqueda por Nombre*

📝 Por favor, escribe el nombre completo o parcial 
de la persona que deseas buscar:

_Ejemplo: Juan Pérez_
```

**Paso 3:** Escribe el nombre (mínimo 3 caracteres):
```
Juan Pérez
```

**Paso 4:** Recibirás los resultados:
```
✅ *Resultados de la búsqueda*

Se encontraron 3 resultado(s):

*1.* Juan Pérez García
   📋 Cédula: 1234567890
   🎂 Nacimiento: 01/01/1990

*2.* Juan Pérez López
   📋 Cédula: 0987654321
   🎂 Nacimiento: 15/05/1985

_Escribe "menu" para volver al menú principal_
```

### 4. Búsqueda por Cédula

**Paso 1:** Escribe `2`

**Paso 2:** El sistema te pedirá la cédula:
```
🆔 *Búsqueda por Cédula*

📝 Por favor, escribe el número de cédula (10 dígitos):

_Ejemplo: 1234567890_
```

**Paso 3:** Escribe la cédula (10 dígitos):
```
1234567890
```

**Paso 4:** Recibirás el resultado:
```
✅ *Resultado de la búsqueda*

👤 *Nombre:* Juan Pérez García
📋 *Cédula:* 1234567890
🎂 *Fecha Nacimiento:* 01/01/1990
💑 *Estado Civil:* Casado
🏠 *Dirección:* Av. Principal 123
📞 *Teléfono:* 0999999999

_Escribe "menu" para volver al menú principal_
```

## 🔧 Comandos Especiales

| Comando | Descripción |
|---------|-------------|
| `menu` o `menú` | Volver al menú principal en cualquier momento |
| `0` o `salir` | Salir del sistema de búsqueda |

## ⏱️ Timeout

- El sistema tiene un **timeout de 2 minutos** de inactividad
- Después de 2 minutos sin interacción, la sesión se cierra automáticamente
- Simplemente escribe `menu` para iniciar una nueva búsqueda

## 🔐 Seguridad

- ✅ Las credenciales se almacenan en variables de entorno (`.env`)
- ✅ Los headers de autenticación se envían en cada petición
- ✅ No se exponen credenciales en el código

## 📡 Endpoints de la API REST

El sistema también expone endpoints para uso programático:

### Iniciar menú manualmente
```bash
POST /menu/start
Content-Type: application/json

{
  "to": "593999999999",
  "menuId": "PRINCIPAL"
}
```

### Obtener estado del menú de un usuario
```bash
GET /menu/status/593999999999
```

### Limpiar estado del menú
```bash
DELETE /menu/clear/593999999999
```

## 🐛 Debugging

### Ver logs del contenedor:
```bash
docker-compose logs -f whatsapp-api
```

### Verificar si el servicio está corriendo:
```bash
docker-compose ps
```

### Reiniciar el servicio:
```bash
docker-compose restart whatsapp-api
```

### Reconstruir después de cambios:
```bash
docker-compose down
docker-compose up --build -d
```

## 📝 Estructura de Archivos

```
src/
├── index.js                    # Servidor principal
├── menuHandler.js              # Sistema de menús original
└── menuHandlerPersona.js       # Sistema de búsqueda de personas ⭐
```

## 🔍 Validaciones

### Cédula:
- ✅ Debe tener exactamente 10 dígitos
- ✅ Solo números (se eliminan espacios y guiones automáticamente)

### Nombre:
- ✅ Mínimo 3 caracteres
- ✅ Puede ser nombre completo o parcial

## ⚠️ Errores Comunes

### 1. "Cannot find module 'dotenv'"
**Solución:** Reconstruir el contenedor
```bash
docker-compose down
docker-compose up --build -d
```

### 2. "Error al realizar la búsqueda: HTTP 401"
**Causa:** Credenciales incorrectas en `.env`

**Solución:** Verificar las variables `AUTHORIZATION` y `AUTHORIZATION_NOMBRES`

### 3. Timeout de sesión
**Causa:** Más de 2 minutos sin interacción

**Solución:** Escribir `menu` para iniciar nueva sesión

## 📊 Formato de Respuestas de API

### API Colmena (Cédula)
```json
{
  "persona": {
    "cedula": "1234567890",
    "nombres": "Juan Pérez García",
    "fecha_nacimiento": "01/01/1990",
    "estado_civil": "Casado",
    "direccion": "Av. Principal 123",
    "telefono": "0999999999"
  }
}
```

### API Nombres
```json
{
  "resultados": [
    {
      "cedula": "1234567890",
      "nombres": "Juan Pérez García",
      "fecha_nacimiento": "01/01/1990"
    }
  ]
}
```

## 🎨 Personalización

Para modificar los mensajes del menú, edita el archivo `src/menuHandlerPersona.js`:

```javascript
const MENUS = {
    PRINCIPAL: {
        id: 'PRINCIPAL',
        title: '🔍 *Búsqueda de Personas*',
        message: 'Personaliza tu mensaje aquí...',
        state: STATES.MENU_PRINCIPAL
    }
};
```

## 📞 Soporte

Si encuentras algún problema:

1. Revisa los logs: `docker-compose logs -f whatsapp-api`
2. Verifica las variables de entorno en `.env`
3. Asegúrate de que las APIs externas estén funcionando
4. Reinicia el contenedor si es necesario

---

**Creado por:** Sistema automatizado
**Fecha:** Octubre 2025
**Versión:** 1.0.0
