# Simple, reliable build for Railway / any Docker host.
FROM node:22-alpine
WORKDIR /app

# Install dependencies (npm install works with or without a lockfile).
COPY package*.json ./
RUN npm install

# App source.
COPY . .

# Uploads default to GridFS (Mongo), but keep /data writable just in case.
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 4000
CMD ["npm", "start"]
