# syntax=docker/dockerfile:1

# ==========================================================
# Multi-stage build for RheoLab Enterprise V2 (static SPA).
#
# The primary distribution channel is the Tauri desktop app.
# This Dockerfile produces an nginx container serving the
# built Vite SPA — useful for preview deploys, docs hosting,
# or CI validation of the frontend build.
# ==========================================================

# ── Stage 1: Build ────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Serve ────────────────────────────────────────
FROM nginx:1.27-alpine AS runner

# SPA fallback: route all paths to index.html
RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
