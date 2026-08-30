FROM node:22-slim AS build
WORKDIR /app
# node:22-slim has no OpenSSL, and Prisma's CLI (generate/migrate, unlike the
# runtime client's driver-adapter query path) shells out to engine binaries
# that need it - without this it silently guesses a version ("may not work
# as expected", per Prisma's own warning) instead of failing loudly.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
ENV DATABASE_URL="file:./build-placeholder.db"
RUN npx prisma generate
RUN npm run build

FROM node:22-slim
WORKDIR /app
# Same reason as the build stage: docker-entrypoint.sh runs `prisma migrate
# deploy` here on every container start, which needs OpenSSL too.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/generated ./generated
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
COPY --from=build /app/package*.json ./
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/src/bot/index.js"]
