# lib.minamorl.com — image built by kyanite (see kyanite.toml, deploy/README.md).
#
# kyanite's builder only runs `docker build --file <this file> <source tree>`:
# no build-args, no secrets. Everything the image needs must therefore come
# from the source tree itself. Two stages: a Node stage that runs the full
# `npm test` (astro check → example check → astro build) so a broken example
# refuses to build an image and the deploy stops there, and a runtime stage
# that is only nginx plus the static dist/.

# --- build: Astro 7 needs Node >= 22.12; .nvmrc pins 24 -------------------
# Build arm64 musl from the checksum-pinned official source; x64 has an official musl binary.
FROM alpine:3.23 AS node26-runtime
ARG NODE_VERSION=26.12.1
ARG TARGETARCH
ENV NODE_VERSION=${NODE_VERSION}
RUN set -eux; \
    test "$NODE_VERSION" = 26.12.1; \
    apk add --no-cache libstdc++ libatomic; \
    apk add --no-cache --virtual .node-build-deps ca-certificates curl xz g++ make python3 linux-headers; \
    case "$TARGETARCH" in \
      amd64) \
        curl --fail --location --proto '=https' --tlsv1.2 -o /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64-musl.tar.xz"; \
        echo "4fd7c15fdc930ea48cf144bb302ce30a76c81920e36473d087720d0810efe1cd  /tmp/node.tar.xz" | sha256sum -c -; \
        tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 ;; \
      arm64) \
        curl --fail --location --proto '=https' --tlsv1.2 -o /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}.tar.xz"; \
        echo "053e3b296859b6d8d93f99ef97fa9cec1c4ee171c72968100c649978c1dbd38c  /tmp/node.tar.xz" | sha256sum -c -; \
        mkdir /tmp/node-source; tar -xJf /tmp/node.tar.xz -C /tmp/node-source --strip-components=1; \
        cd /tmp/node-source; ./configure --prefix=/usr/local; make -j"$(getconf _NPROCESSORS_ONLN)"; make install ;; \
      *) echo "unsupported Node architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    cd /; rm -rf /tmp/node-source /tmp/node.tar.xz; apk del .node-build-deps; \
    addgroup -g 1000 node; adduser -D -u 1000 -G node node; \
    test "$(node --version)" = "v${NODE_VERSION}"; npm --version

FROM node26-runtime AS build
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
