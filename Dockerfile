FROM node:20-alpine AS builder

WORKDIR /app

COPY container/package.json container/package-lock.json* ./
RUN npm ci

COPY container/server.ts container/tsconfig.json ./
RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY container/package.json container/package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 8080

CMD ["node", "dist/server.js"]
