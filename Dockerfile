FROM node:20-alpine

WORKDIR /app

COPY container/package.json container/package-lock.json* ./
RUN npm ci --omit=dev

COPY container/server.js ./

EXPOSE 8080

CMD ["node", "server.js"]
