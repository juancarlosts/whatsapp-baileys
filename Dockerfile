# Dockerfile
FROM node:20-alpine

WORKDIR /app

# Copiar package.json primero para aprovechar caché
COPY package*.json ./

# Instalar SOLO en base al lockfile → rápido y determinista
RUN npm ci --omit=dev && npm cache clean --force

# Copiar el código fuente
COPY . .

# Crear directorio de sesión (aunque se montará desde fuera)
RUN mkdir -p /app/session

EXPOSE 8080

CMD ["npm", "start"]