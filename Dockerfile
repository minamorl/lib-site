# lib.minamorl.com — image built by kyanite (see kyanite.toml, deploy/README.md).
#
# kyanite's builder only runs `docker build --file <this file> <source tree>`:
# no build-args, no secrets. Everything the image needs must therefore come
# from the source tree itself. Two stages: a Node stage that runs the full
# `npm test` (astro check → example check → astro build) so a broken example
# refuses to build an image and the deploy stops there, and a runtime stage
# that is only nginx plus the static dist/.

# --- build: Astro 7 needs Node >= 22.12; .nvmrc pins 24 -------------------
FROM node:24-alpine AS build
WORKDIR /app

# Lockfile first so the dependency layer is reused while only content changes.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# check → check:examples → build. dist/ is the only output that matters.
RUN npm test
# COPY keeps the source tree's modes (a 0600 checkout would leave files the
# runtime user cannot read); normalise dist/ before it crosses stages.
RUN chmod -R a+rX /app/dist

# --- runtime: nginx as an unprivileged user (uid 101), listening on 8080 ----
# The base image keeps /docker-entrypoint.sh (templating hooks) and sets
# USER 101; nothing here overrides either.
FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime

# Replace the stock default server block with ours (deploy/container/).
# --chmod: nginx runs as uid 101 and must be able to read it whatever mode
# the source checkout had.
COPY --chmod=0644 deploy/container/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
# Must match [process] command in kyanite.toml: the runtime passes that
# command as the container argv and it overrides this CMD.
CMD ["nginx", "-g", "daemon off;"]
