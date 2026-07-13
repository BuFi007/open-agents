FROM oven/bun:1.3.10-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock turbo.json ./
COPY apps ./apps
COPY packages ./packages
RUN bun install --frozen-lockfile --production

WORKDIR /app/apps/knowledge-worker
EXPOSE 3001
CMD ["bun", "index.ts"]
