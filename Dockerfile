# Site estático servido pelo Nginx (porta 80). Usado pelo Coolify com o build pack "Dockerfile".
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html app.js exercises.js styles.css sw.js manifest.webmanifest icon.svg /usr/share/nginx/html/
EXPOSE 80
