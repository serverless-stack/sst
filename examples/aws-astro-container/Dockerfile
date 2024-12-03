FROM node:lts AS base
WORKDIR /app

COPY package.json package-lock.json ./

FROM base AS prod-deps
RUN npm install --omit=dev

FROM base AS build-deps
RUN npm install

FROM build-deps AS build
COPY . .
RUN npm run build

FROM base AS runtime
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321
CMD node ./dist/server/entry.mjs
