# Based on https://github.com/remix-run/blues-stack/blob/main/Dockerfile

FROM node:lts-alpine as base
ENV NODE_ENV production

# Stage 1: Install all node_modules, including dev dependencies
FROM base as deps
WORKDIR /myapp
ADD package.json ./
RUN npm install --include=dev

# Stage 2: Setup production node_modules
FROM base as production-deps
WORKDIR /myapp
COPY --from=deps /myapp/node_modules /myapp/node_modules
ADD package.json ./
RUN npm prune --omit=dev

# Stage 3: Build the app
FROM base as build
WORKDIR /myapp
COPY --from=deps /myapp/node_modules /myapp/node_modules
ADD . .
RUN npm run build

# Stage 4: Build the production image
FROM base
WORKDIR /myapp
COPY --from=production-deps /myapp/node_modules /myapp/node_modules
COPY --from=build /myapp/build /myapp/build
COPY --from=build /myapp/public /myapp/public
ADD . .

CMD ["npm", "start"]
