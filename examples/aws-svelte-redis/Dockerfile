FROM node:lts-alpine AS builder

# Add linked resources to the environment
ARG SST_RESOURCE_MyRedis

WORKDIR /app

COPY package*.json .

RUN npm install

COPY . .

RUN npm run build
RUN npm prune --prod

FROM builder AS deployer

WORKDIR /app

COPY --from=builder /app/build build/
COPY --from=builder /app/package.json .

EXPOSE 3000

ENV NODE_ENV=production

CMD [ "node", "build" ]
