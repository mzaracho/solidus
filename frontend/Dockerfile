# Build Stage
FROM node:22-alpine AS builder
WORKDIR /app

# CA raiz extra opcional (antivirus o proxy que inspeccionan HTTPS): secreto de BuildKit "extra_ca".
# Sin el secreto el build es el de siempre. Ver docker-compose.extra-ca.yml y .\dev.ps1 -ExportCa.
# El secreto y el script se montan solo durante cada RUN: no quedan en ninguna capa.
RUN --mount=type=secret,id=extra_ca \
    --mount=type=bind,source=docker/with-extra-ca.sh,target=/tmp/with-extra-ca.sh \
    sh /tmp/with-extra-ca.sh apk add --no-cache libc6-compat

# Build Args for Inling
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

COPY package*.json ./
RUN --mount=type=secret,id=extra_ca \
    --mount=type=bind,source=docker/with-extra-ca.sh,target=/tmp/with-extra-ca.sh \
    sh /tmp/with-extra-ca.sh npm install
COPY . .
# next build descarga Google Fonts (next/font/google): necesita la red del build.
RUN --mount=type=secret,id=extra_ca \
    --mount=type=bind,source=docker/with-extra-ca.sh,target=/tmp/with-extra-ca.sh \
    sh /tmp/with-extra-ca.sh npm run build

# Run Stage
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV production

COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000
CMD ["npm", "start"]
