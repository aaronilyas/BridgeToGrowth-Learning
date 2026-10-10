FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY services/messaging/package.json services/messaging/package-lock.json ./
RUN npm ci
COPY services/messaging/tsconfig.json ./
COPY services/messaging/src ./src
RUN npm run typecheck && npm run build

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY services/messaging/package.json services/messaging/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim
ENV NODE_ENV=production HOME=/tmp
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY services/messaging/package.json ./package.json
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/index.js"]
