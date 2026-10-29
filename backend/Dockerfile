# Build Stage
FROM node:22-alpine AS builder
WORKDIR /app

# CA raiz extra opcional (antivirus o proxy que inspeccionan HTTPS): secreto de BuildKit "extra_ca".
# Sin el secreto el build es el de siempre. Ver docker-compose.extra-ca.yml y .\dev.ps1 -ExportCa.
# El secreto y el script se montan solo durante cada RUN: no quedan en ninguna capa.

# openssl en el builder: Prisma detecta la plataforma por la presencia de openssl. Sin el, el builder
# se detecta como "linux-musl" y baja un schema engine que el runner (que si tiene openssl 3, o sea
# "linux-musl-openssl-3.0.x") no usaria: lo descargaria en runtime, sin la CA. Con openssl ambos coinciden.
RUN --mount=type=secret,id=extra_ca \
    --mount=type=bind,source=docker/with-extra-ca.sh,target=/tmp/with-extra-ca.sh \
    sh /tmp/with-extra-ca.sh apk add --no-cache openssl

# Dependencies
COPY package*.json ./
COPY prisma ./prisma/
RUN --mount=type=secret,id=extra_ca \
    --mount=type=bind,source=docker/with-extra-ca.sh,target=/tmp/with-extra-ca.sh \
    sh /tmp/with-extra-ca.sh npm install --legacy-peer-deps
RUN --mount=type=secret,id=extra_ca \
    --mount=type=bind,source=docker/with-extra-ca.sh,target=/tmp/with-extra-ca.sh \
    sh /tmp/with-extra-ca.sh npx prisma generate
# Descarga aqui (con la CA extra si hay) el schema engine que usa "prisma migrate deploy" al arrancar:
# "prisma generate" solo baja el query engine. Va dentro de node_modules, que se copia al runner,
# asi en runtime no hay descargas a binaries.prisma.sh.
RUN --mount=type=secret,id=extra_ca \
    --mount=type=bind,source=docker/with-extra-ca.sh,target=/tmp/with-extra-ca.sh \
    sh /tmp/with-extra-ca.sh npx prisma -v
# Verificacion: si falta algun engine de la plataforma del runner, el build falla aqui y no en runtime.
RUN test -f node_modules/@prisma/engines/schema-engine-linux-musl-openssl-3.0.x \
    && test -f node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node

# Build
COPY . .
RUN npm run build
# Note: NOT pruning production deps to ensure 'prisma' CLI is available for migration

# Run Stage
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV production

# Install Netcat and OpenSSL for DB wait check and Prisma
RUN --mount=type=secret,id=extra_ca \
    --mount=type=bind,source=docker/with-extra-ca.sh,target=/tmp/with-extra-ca.sh \
    sh /tmp/with-extra-ca.sh apk add --no-cache netcat-openbsd openssl

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 8080

# Wait for DB, migrate, then start
CMD ["/bin/sh", "-c", "while ! nc -z db 5432; do sleep 1; done; npx prisma migrate deploy; npm run start:prod"]
