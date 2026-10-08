# Imagen de producción de DayOff Studio
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p uploads
EXPOSE 3000
CMD ["sh", "-c", "npm run db:init && npm start"]
