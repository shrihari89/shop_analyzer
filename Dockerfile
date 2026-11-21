# ---- Stage 1: Build React + Vite Frontend ----
FROM node:24-alpine AS frontend-builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Render automatically passes Environment Variables as Docker build arguments
ARG VITE_GOOGLE_MAPS_API_KEY
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY

COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src

RUN npm run build

# ---- Stage 2: Production Server (Express + Built Frontend) ----
FROM node:24-alpine AS production

WORKDIR /app

COPY server/package.json ./server/
WORKDIR /app/server
RUN npm install --omit=dev

WORKDIR /app
COPY server/index.js ./server/index.js
COPY --from=frontend-builder /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "server/index.js"]