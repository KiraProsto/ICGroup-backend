# ─────────────────────────────────────────────────────────────
#  Stage 1: dependencies
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

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

# Install only production deps
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy compiled output and generated Prisma client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/generated ./src/generated

# Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs
USER nestjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/src/main.js"]
