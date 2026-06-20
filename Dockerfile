# Builds gecko-mcp from source and runs it as a stdio MCP server.
# Used by Glama (https://glama.ai/mcp/servers) to start the server and verify it
# responds to MCP introspection (tools/list). The server registers all tools at
# startup without needing a browser, so introspection passes in a bare container;
# actual browser tools require a running Gecko browser at runtime.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# stdio transport — Glama communicates over stdin/stdout
CMD ["node", "dist/index.js"]
