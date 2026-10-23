# One image for the API, the worker and migrations (they differ only by command).
# Build from the repo root:  docker build -f apps/api/Dockerfile .

# --- build: install all deps (incl. TypeScript) and compile ---
FROM node:22-alpine AS build
WORKDIR /repo
# Workspace manifests first, so the npm install layer is cached until they change.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/api
COPY apps/api apps/api
RUN npm run build -w apps/api

# --- runtime: production deps + compiled JS only ---
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/api --omit=dev && npm cache clean --force
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
# Shared uploads directory (a volume in compose), writable by the non-root user.
RUN mkdir -p /data/uploads && chown node:node /data/uploads
ENV UPLOAD_DIR=/data/uploads

WORKDIR /repo/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://localhost:4000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]
