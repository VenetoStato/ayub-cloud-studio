# AYUB CLOUD STUDIO — immagine di produzione
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN sh scripts/fetch-samples.sh && npx vite build && npm prune --omit=dev

FROM node:20-alpine
# gira come root nel container: evita problemi di permessi sul bind mount ./data
ENV NODE_ENV=production \
    PORT=8790 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
VOLUME ["/data"]
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8790/healthz || exit 1
CMD ["node", "server/server.js"]
