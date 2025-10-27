FROM node:20-alpine AS builder

WORKDIR /app

COPY container/package.json container/package-lock.json* ./
RUN npm ci

COPY container/server.ts container/tsconfig.json ./
RUN npm run build

FROM node:20-alpine

WORKDIR /app

# Install bash (required by Claude Agent SDK)
RUN apk add --no-cache bash

COPY container/package.json container/package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Copy skills to project-level directory for auto-discovery
COPY .claude ./.claude

# Change ownership and switch to non-root user (required for bypassPermissions mode)
RUN chown -R node:node /app
USER node

# Set SHELL environment variable to bash for Claude Agent SDK
ENV SHELL=/bin/bash

EXPOSE 8080

CMD ["node", "dist/server.js"]
