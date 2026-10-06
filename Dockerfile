# App web + API de sincronização (Node, sem dependências), porta 80.
# Os dados ficam em /data: no Coolify, crie um volume persistente nesse caminho.
FROM node:22-alpine
WORKDIR /app
COPY server.js ./
COPY index.html app.js exercises.js styles.css sw.js manifest.webmanifest icon.svg ./public/
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
CMD ["node", "server.js"]
