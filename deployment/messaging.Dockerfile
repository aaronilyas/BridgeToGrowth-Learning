FROM oven/bun:1.3 AS dependencies
WORKDIR /app
COPY services/messaging/package.json services/messaging/bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3
ENV NODE_ENV=production HOME=/tmp
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY services/messaging/package.json ./package.json
COPY services/messaging/src/index.ts services/messaging/src/delivery.ts services/messaging/src/photon.ts ./src/
USER bun
CMD ["bun", "src/index.ts"]
