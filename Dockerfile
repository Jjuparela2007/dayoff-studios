# Imagen de producción de DayOff Studio
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p uploads
EXPOSE 3000
# Al arrancar: crea/verifica tablas, primer administrador y ajustes nuevos (sin borrar nada) y levanta el sitio
CMD ["npm", "run", "railway:start"]
