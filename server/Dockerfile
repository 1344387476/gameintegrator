ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --registry="${NPM_REGISTRY}" --omit=dev --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY migrations ./migrations
RUN mkdir -p /app/data/avatars && chown node:node /app/data/avatars
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
# 同一端口同时承载REST和WebSocket Upgrade。
EXPOSE 3000
CMD ["node", "src/index.js"]
