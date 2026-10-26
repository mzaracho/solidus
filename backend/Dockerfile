# Build Stage
FROM node:22-alpine AS builder
WORKDIR /app

# Dependencies
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install --legacy-peer-deps
RUN npx prisma generate

# Build
COPY . .
RUN npm run build
# Note: NOT pruning production deps to ensure 'prisma' CLI is available for migration

# Run Stage
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV production

# Install Netcat and OpenSSL for DB wait check and Prisma
RUN apk add --no-cache netcat-openbsd openssl

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 8080

# Wait for DB, migrate, then start
CMD ["/bin/sh", "-c", "while ! nc -z db 5432; do sleep 1; done; npx prisma migrate deploy; npm run start:prod"]
