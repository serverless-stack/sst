FROM node:18-bullseye-slim

WORKDIR /app/

COPY package.json /app
RUN npm install

COPY index.mjs /app

ENTRYPOINT ["node", "index.mjs"]
