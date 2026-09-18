# deploy/ — lib.minamorl.com on vultr through kyanite

lib.minamorl.com is a tenant of [kyanite](file:///home/minamorl/repos/kyanite)
(self-hosted deployment platform, Rust CLI) on vultr. This directory holds
everything about *delivery*, versioned with the site. The image itself
(`Dockerfile`) and the tenant manifest (`kyanite.toml`) live at the repo root
and are owned separately.

## Request path

```
browser
  │ https
  ▼
Cloudflare (proxied A record lib → 64.176.43.103)
  │ https, 443 only reaches the origin
  ▼
vultr nginx: front vhost  /etc/nginx/sites-enabled/lib.minamorl.com   (this repo: deploy/nginx/)
  listen 443 ssl · *.minamorl.com wildcard cert · server_name lib.minamorl.com
  │ proxy_pass http://127.0.0.1:80, Host preserved
  ▼
vultr nginx: kyanite block   /var/lib/kyanite/nginx/<app>.conf   (written by kyanite, listen 80)
  server_name lib.minamorl.com → upstream 127.0.0.1:<docker-published port>
  │
  ▼
container  kyanite-<deployment-id>   port 8080   (blue-green: the block is re-pointed per deploy)
```

Why 443 is terminated outside kyanite: kyanite's router only emits
`listen 80` blocks and has no notion of certificates. The front vhost owns TLS
once and never changes per deploy; every switch happens inside the kyanite
block. The front vhost deliberately has **no** `listen 80` (kyanite's block is
the `:80` owner for that name).

Known wrinkle: kyanite's block sets `X-Forwarded-Proto $scheme`, which is
`http` at the loopback hop, so the container sees `X-Forwarded-Proto: http`
even though the front sets `https`. Fix belongs in kyanite's router, not here.
`X-Forwarded-For` survives (`client, 127.0.0.1`).

Before the first deploy there is no kyanite block, so the loopback hop lands
on vultr's default `:80` server and the edge shows a `301` loop. That clears
the moment the first `kyanite deploy` publishes the route.

## What is installed on vultr (by `deploy/vultr-bootstrap.sh`)

| path on vultr | from | purpose |
|---|---|---|
| `/usr/local/bin/kyanite` | `~/repos/kyanite` built at HEAD | the CLI; built commit recorded in `/usr/local/share/kyanite/commit` |
| `/usr/local/share/kyanite/commit` | generated | `295409a91ba590086dc4d72ae58e20af1b991a16` (branch `feat/kyanite-cli`) at bootstrap on 2026-09-18 |
| `/var/lib/kyanite/` (+ `nginx/`) | generated, minamorl 0755 | ledger (`ledger.sqlite`), exported sources, route includes |
| `/etc/nginx/conf.d/kyanite.conf` | generated | `include /var/lib/kyanite/nginx/*.conf;` |
| `/etc/nginx/sites-available/lib.minamorl.com` (+ `sites-enabled` symlink) | `deploy/nginx/lib.minamorl.com.conf` | the 443 front vhost |
| `/usr/local/bin/kyanite-nginx` | `deploy/kyanite-nginx` | `--nginx` shim: `sudo -n nginx -t` / `-s reload` only, else exit 64 |
| `/usr/local/bin/lib-site-ci-deploy` | `deploy/lib-site-ci-deploy` | ssh forced command for the CI key |
| `/home/minamorl/repos/lib-site` | `git clone git@github.com:minamorl/lib-site.git` | deploy-only checkout; `[source] repo` for the manifest. Never edit it |
| `~/.ssh/authorized_keys` (last line) | op C below | `restrict,command="/usr/local/bin/lib-site-ci-deploy" ssh-ed25519 … lib-deploy-ci` |

Re-running the bootstrap is safe: identical files are skipped, a differing
existing file stops it with exit 70 and the path, nothing is deleted. To roll
a newer version of one file, opt in by destination path:
`LIB_SITE_BOOTSTRAP_UPDATE=/usr/local/bin/lib-site-ci-deploy` (space-separated
for several). A newer kyanite HEAD is rebuilt and reinstalled; the recorded
commit changes with it.

```sh
# once deploy/ is on main, the default source is the deploy checkout's own deploy/:
ssh vultr "bash -s" < deploy/vultr-bootstrap.sh
# before that, or to bootstrap from a branch:
scp -r deploy vultr:/tmp/lib-site-deploy
ssh vultr "LIB_SITE_DEPLOY_SRC=/tmp/lib-site-deploy bash -s" < deploy/vultr-bootstrap.sh
```

The script pins `CC=/usr/bin/cc` for cargo because `~/.local/bin/cc` on vultr
is a Claude Code launcher that shadows the C compiler.

## DNS (Cloudflare, zone `87218e5761297ce42cd0887b0b198945`)

| record | id | value |
|---|---|---|
| `A lib.minamorl.com` | `3ec78acb0a692c44938a18db6468afd0` | `64.176.43.103`, proxied, auto TTL — created 2026-09-18 |

Rollback of the DNS change:

```sh
curl -X DELETE -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  https://api.cloudflare.com/client/v4/zones/87218e5761297ce42cd0887b0b198945/dns_records/3ec78acb0a692c44938a18db6468afd0
```

## GitHub Actions (`.github/workflows/deploy.yml`)

Triggers: `push` to `main`, `workflow_dispatch`. One deploy at a time
(`concurrency: lib-site-deploy`, no cancel). The job:

1. checks the four secrets exist, otherwise writes "Deploy skipped" to the run
   summary and stops green;
2. `ssh -i key minamorl@vultr "deploy ${GITHUB_SHA}"` → forced command runs
   `kyanite deploy` + `kyanite gc`;
3. `ssh … "status"` → must report `kyanite[0].latest.state == "live"` and
   `live.commit == ${GITHUB_SHA}`, else the run fails;
4. `curl -fsS https://lib.minamorl.com/` must be 2xx (5 tries, 10 s apart).

### Secrets (set 2026-09-18, `gh secret set -R minamorl/lib-site`)

| secret | value / how made |
|---|---|
| `DEPLOY_SSH_KEY` | private half of `ssh-keygen -t ed25519 -C lib-deploy-ci`; fingerprint `SHA256:Jhsl66XnEkdvcm2FV4S5vBVEGb72pc1lE77XISOtJ38`. The private key exists only in this secret |
| `DEPLOY_HOST` | `64.176.43.103` |
| `DEPLOY_USER` | `minamorl` |
| `DEPLOY_KNOWN_HOSTS` | output of `ssh-keyscan -t ed25519 64.176.43.103` (pinned; the workflow uses `StrictHostKeyChecking=yes`) |

To rotate the key: generate a new pair, replace `DEPLOY_SSH_KEY`, replace the
`lib-deploy-ci` line in vultr's `~/.ssh/authorized_keys` (keep the
`restrict,command=…` prefix). To revoke: delete that one line.

### The forced command (`deploy/lib-site-ci-deploy`)

The CI key cannot open a shell. `sshd` runs `/usr/local/bin/lib-site-ci-deploy`
with the requested command in `SSH_ORIGINAL_COMMAND`:

| command | effect | exit |
|---|---|---|
| `deploy <40-hex sha>` | `flock` → `git fetch origin` → require `sha` ∈ `origin/main` → `git reset --hard sha` → `kyanite deploy lib.minamorl.com <sha> --manifest …/kyanite.toml --nginx /usr/local/bin/kyanite-nginx --json` → `kyanite gc lib.minamorl.com --manifest … --json` | kyanite's |
| `deploy <sha>` where the checkout at `sha` has no `kyanite.toml` | kyanite is not called; prints `{"skipped":"no kyanite.toml at <sha>"}` — CI writes "Deploy skipped: …" to the summary, skips the status/curl checks and ends green | 0 |
| `status` | `{"app", "kyanite": <kyanite status --json>, "live": {commit, release_id, deployment_id} \| null}` — `live` is read from the ledger because kyanite's status JSON does not carry the source commit | kyanite's |
| anything else | refused, nothing touched | 64 |
| `deploy` of a sha not on `origin/main` | refused | 65 |

`status` exits 1 with `app_not_registered` until the first deploy has happened.

## Manual operations (on vultr, as minamorl)

```sh
# deploy a specific main commit exactly as CI would
SSH_ORIGINAL_COMMAND="deploy <sha>" /usr/local/bin/lib-site-ci-deploy

# or by hand
cd ~/repos/lib-site && git fetch origin && git reset --hard origin/main
kyanite deploy lib.minamorl.com origin/main --manifest ~/repos/lib-site/kyanite.toml \
  --nginx /usr/local/bin/kyanite-nginx --fetch

# what is live, with history
kyanite status lib.minamorl.com --history 5

# rollback to the previous release (same health gate, same route switch)
kyanite rollback lib.minamorl.com
kyanite rollback lib.minamorl.com --to <release-id>   # a specific one

# reclaim images the retention policy no longer keeps
kyanite gc lib.minamorl.com --manifest ~/repos/lib-site/kyanite.toml

# routes and containers as nginx/docker see them
cat /var/lib/kyanite/nginx/*.conf
docker ps --filter label=io.kyanite.managed=true
```

`kyanite` finds the ledger at `/var/lib/kyanite` by default; `--nginx` must be
the shim (plain `nginx -t` as minamorl is Permission denied).

## Reusing this for yui

Host-wide, already in place and shared by every tenant: the kyanite binary,
`/var/lib/kyanite`, `/etc/nginx/conf.d/kyanite.conf`, the `kyanite-nginx`
shim. Per tenant, copy and rename:

- `deploy/nginx/lib.minamorl.com.conf` → same file with the other
  `server_name` (still no `listen 80`, still the wildcard cert);
- `deploy/lib-site-ci-deploy` → change `APP`, `CHECKOUT`, `LOCK`; give it its
  own deploy key and `authorized_keys` line;
- `.github/workflows/deploy.yml` → change the hostname in the final `curl`;
- a `kyanite.toml` at the tenant repo root with `[source] repo` pointing at
  its deploy checkout, and a proxied Cloudflare A record.

`vultr-bootstrap.sh` is lib-site specific in steps 4 and 6 only; steps 1–3 and
5 are the shared part.

## Tenant (the image and the manifest)

| file | role |
|---|---|
| `Dockerfile` | two stages: `node:24-alpine` runs `npm ci` + `npm test` (check → examples → build), `nginxinc/nginx-unprivileged:stable-alpine` serves `dist/` on 8080 as uid 101. A failing example fails the build, so the deploy stops before anything is started |
| `deploy/container/nginx.conf` | the server block inside the container (`/etc/nginx/conf.d/default.conf`): `/healthz` 200, `/_astro/` immutable for a year, pages `no-cache`, `try_files … =404` with Astro's `404.html`, relative redirects (`absolute_redirect off`) so `/darkcore` → `/darkcore/` survives the proxy hops |
| `.dockerignore` | keeps `node_modules`, `dist`, `.git`, `.github`, `.evidence` and `deploy/` (except `deploy/container`) out of the build context |
| `kyanite.toml` | the manifest; every key is commented in place. `[process] command` must stay equal to the Dockerfile `CMD`, `[health] port` to `[process] port` |

Local check of the image, same probes as the first deploy used:

```sh
docker build -t lib-site:test .
docker run --rm -d --name lib-site-test -p 127.0.0.1:8080:8080 lib-site:test
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/healthz    # 200
curl -sI http://127.0.0.1:8080/darkcore | grep Location                    # Location: /darkcore/
docker exec lib-site-test id                                                # uid=101(nginx)
docker rm -f lib-site-test
```

Deploying a tree that is not on `origin/main` yet (first deploy of a branch):
`kyanite deploy` accepts a directory source; without `.git` it needs
`--commit`.

```sh
rsync -a --exclude node_modules --exclude dist --exclude .git --exclude .astro ./ vultr:/tmp/lib-site-src/
ssh vultr "kyanite deploy lib.minamorl.com /tmp/lib-site-src --manifest /tmp/lib-site-src/kyanite.toml \
  --commit $(git rev-parse HEAD) --nginx /usr/local/bin/kyanite-nginx --json; rm -rf /tmp/lib-site-src"
```

The build pulls two base images and materialises `node_modules` inside the
build cache; budget a few GB free on vultr's `/` before the first deploy.
