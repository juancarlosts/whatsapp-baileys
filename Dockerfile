# Dockerfile
FROM node:20-alpine

# Instalar git y otras dependencias del sistema necesarias
RUN apk add --no-cache git

WORKDIR /app

# Copiar package.json primero para aprovechar caché
COPY package*.json ./

# Instalar TODAS las dependencias necesarias
RUN npm install && npm cache clean --force

# Copiar el código fuente (sin node_modules local)
COPY . .

# Crear directorio de sesión (aunque se montará desde fuera)
RUN mkdir -p /app/session

EXPOSE 8080

# Ejecutar la aplicación (las dependencias ya están instaladas)
CMD ["npm", "start"]