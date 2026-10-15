FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist
# Dossier de travail des fichiers bulk Eurostat (l'application ne tourne pas en root)
RUN mkdir -p data/bulk && chown -R node:node data
EXPOSE 4000
USER node
CMD ["node", "src/index.js"]
