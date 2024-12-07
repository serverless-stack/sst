FROM node:lts-alpine

WORKDIR /app/

COPY package.json /app
RUN npm install

COPY index.mjs /app

ENTRYPOINT ["node", "index.mjs"]
