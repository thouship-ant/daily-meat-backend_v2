FROM node:22-bookworm-slim AS base
# openssl: required by Prisma's query engine
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata openssl \
    && rm -rf /var/lib/apt/lists/*
ENV TZ=Asia/Kolkata
WORKDIR /app

# ---- build / tools: full install (Prisma CLI, ts-node). Compiles the app and is also used for one-off jobs
#      (migrations, admin seeding): `docker compose run --rm migrate`, `... run --rm tools ...`
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- runtime: production dependencies only, non-root
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
USER node
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
