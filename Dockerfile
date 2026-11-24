# Build from the repository root so the shared Telnet and SCS engine is included.
FROM node:24-bookworm-slim AS build
WORKDIR /app/web-monologue
COPY web-monologue/package.json web-monologue/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src/ /app/src/
COPY web-monologue/ ./
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    LISTEN_HOST=0.0.0.0 \
    DATA_DIR=/app/data
WORKDIR /app
COPY --from=build /app/web-monologue/dist/ ./dist/
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.cjs"]
