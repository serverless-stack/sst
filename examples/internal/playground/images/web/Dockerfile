FROM node:18-bullseye-slim
ARG SST_RESOURCE_MyBucket

WORKDIR /app/

COPY package.json /app
RUN npm install

# Ensure linked resources are available at build time
COPY build.mjs /app
RUN node build.mjs

COPY index.mjs /app

ENTRYPOINT ["node", "index.mjs"]