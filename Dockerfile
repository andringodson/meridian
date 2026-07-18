# Meridian — reproducible build + preview toolchain.
#
# This is a TOOLING image, not the production runtime: the live site is served
# by Vercel's CDN (static bundle) + serverless functions. Use this to build the
# minified bundle and preview it exactly as shipped, on any machine, without a
# local Node/toolchain setup. See docker-compose.yml for the audit workflow.
#
#   docker build -t meridian .
#   docker run --rm -p 8080:8080 meridian     # → http://localhost:8080

# ---- build: install tools, produce the minified dist/ ----
FROM node:22-alpine AS build
WORKDIR /app
# Install with a clean, reproducible tree (needs the lockfile).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- preview: serve the built bundle with zero runtime deps ----
FROM node:22-alpine AS preview
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/serve.mjs ./scripts/serve.mjs
EXPOSE 8080
CMD ["node", "scripts/serve.mjs", "dist", "8080"]
