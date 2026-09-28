# Caddy: serve il client (build fatta qui) e fa da reverse proxy verso il server, con HTTPS automatico.
# Contesto di build: la radice del repository (vedi deploy/docker-compose.yml).

FROM node:22-bookworm-slim AS client
WORKDIR /client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
# Gli indirizzi del server finiscono nel bundle al momento della build (solo variabili VITE_*).
ARG VITE_API_BASE_URL
ARG VITE_WS_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_WS_URL=${VITE_WS_URL}
RUN npm run build

FROM caddy:2
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=client /client/dist /srv/client
