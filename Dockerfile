# Container image for the partner-center-mcp stdio server.
# Glama (and any MCP host) can build this, start it, and send introspection
# (initialize / tools-list) requests over stdio.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY data ./data
# The server speaks MCP over stdio.
ENTRYPOINT ["node", "dist/index.js"]
