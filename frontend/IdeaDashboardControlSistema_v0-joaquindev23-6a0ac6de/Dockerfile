# Multi-stage build: deps → build → runner
# Uses npm (compatible con todos los Node.js modernos)

# ── Stage 1: Dependencies ──────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies with npm (no lockfile issues)
RUN npm install

# ── Stage 2: Build ────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build the Next.js application
RUN npm run build

# ── Stage 3: Production runner ─────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
	adduser --system --uid 1001 nextjs

# Copy built assets
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node_modules/.bin/next", "start"]
