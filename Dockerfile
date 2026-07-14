# ---------- Base ----------
FROM node:22-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# ---------- Build ----------
FROM base AS builder
COPY package*.json ./
# mount npm cache for faster GH Actions builds
RUN --mount=type=cache,target=/root/.npm npm ci --production=false
COPY . .

# ---------- Run ----------
FROM base AS runner
WORKDIR /app

# Copy app files while still root
COPY --from=builder /app ./

# Create a non-root user and switch to it
RUN mkdir -p /data && chown -R node:node /data

# Copy app files
COPY --from=builder --chown=node:node /app ./

# Drop privileges to the non-root 'node' user
USER node

EXPOSE 4000
CMD ["npm", "start"]
