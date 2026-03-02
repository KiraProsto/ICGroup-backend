# ─────────────────────────────────────────────────────────────
#  Stage 1: dependencies
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Build tools required by native addons (argon2 compiles a C++ binding)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

# ─────────────────────────────────────────────────────────────
#  Stage 2: development (used by docker-compose for hot reload)
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS development
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate 2>/dev/null || true

EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# ─────────────────────────────────────────────────────────────
#  Stage 3: builder
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
RUN npm run build

# ─────────────────────────────────────────────────────────────
#  Stage 4: production
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

# Copy the pre-built node_modules (native bindings already compiled) and prune
# dev-only packages. This avoids re-compiling argon2 without needing build tools.
COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
RUN npm prune --omit=dev

# Copy compiled output and generated Prisma client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/generated ./src/generated

# Copy Prisma schema — required by `prisma migrate deploy` at container start
COPY --from=builder /app/prisma ./prisma

# Copy migration entrypoint
COPY docker-entrypoint.sh ./

# Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs && \
    chmod +x docker-entrypoint.sh
USER nestjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/src/main.js"]
