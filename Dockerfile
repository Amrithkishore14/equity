FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# Install dependencies separately to leverage cache
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Expose runtime port (Render/Heroku will override)
EXPOSE 3000

# Use production start
CMD ["node", "server/server.js"]
