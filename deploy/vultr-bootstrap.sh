#!/usr/bin/env bash
# vultr-bootstrap.sh — make vultr able to host lib.minamorl.com as a kyanite tenant.
#
# Idempotent. Run as minamorl on vultr (sudo -n is NOPASSWD there):
#
#   ssh vultr "bash -s" < deploy/vultr-bootstrap.sh
#
# The files it installs come from a deploy/ directory on the host. By default
# that is the deploy checkout's own deploy/ (/home/minamorl/repos/lib-site/deploy,
# valid once this directory has landed on main). Before that, copy it up and
# point the script at it:
#
#   scp -r deploy vultr:/tmp/lib-site-deploy
#   ssh vultr "LIB_SITE_DEPLOY_SRC=/tmp/lib-site-deploy bash -s" < deploy/vultr-bootstrap.sh
#
# What it does, in order:
#   1. cargo build --release kyanite at the checkout's HEAD, install to
#      /usr/local/bin/kyanite, record the built commit in
#      /usr/local/share/kyanite/commit (skipped when that commit is already installed).
#   2. /var/lib/kyanite and /var/lib/kyanite/nginx, minamorl-owned, 0755.
#   3. /etc/nginx/conf.d/kyanite.conf pulling in kyanite's route includes.
#   4. The front vhost, the nginx shim and the CI forced command.
#   5. sudo nginx -t, and only if that passes, systemctl reload nginx.
#   6. git clone the deploy checkout if it is missing.
#
# Existing files are never overwritten: an identical file is left alone, a
# differing one stops the script with exit 70 and its path. Nothing is deleted.
# To roll a newer version of one file, name its destination explicitly:
#
#   ssh vultr "LIB_SITE_DEPLOY_SRC=/tmp/lib-site-deploy \
#              LIB_SITE_BOOTSTRAP_UPDATE=/usr/local/bin/lib-site-ci-deploy bash -s" \
#     < deploy/vultr-bootstrap.sh
set -euo pipefail

KYANITE_REPO=/home/minamorl/repos/kyanite
KYANITE_BIN=/usr/local/bin/kyanite
KYANITE_COMMIT_FILE=/usr/local/share/kyanite/commit
STATE_DIR=/var/lib/kyanite
CHECKOUT=/home/minamorl/repos/lib-site
CHECKOUT_REMOTE=git@github.com:minamorl/lib-site.git
SRC="${LIB_SITE_DEPLOY_SRC:-$CHECKOUT/deploy}"
OWNER=minamorl

log() { printf 'bootstrap: %s\n' "$*"; }
die() { printf 'bootstrap: %s\n' "$1" >&2; exit "${2:-1}"; }

# install_file SRC DST MODE — install unless DST already holds identical bytes.
# A differing DST is refused (exit 70) unless its path is listed in
# LIB_SITE_BOOTSTRAP_UPDATE (space-separated), the explicit opt-in for
# rolling a newer version of a file this script owns.
install_file() {
    local src="$1" dst="$2" mode="$3" verb=installed
    [[ -f $src ]] || die "missing source file $src"
    if [[ -e $dst ]]; then
        if sudo -n cmp -s "$src" "$dst"; then
            log "unchanged $dst"
            return 0
        fi
        case " ${LIB_SITE_BOOTSTRAP_UPDATE:-} " in
            *" $dst "*) verb=updated ;;
            *) die "$dst exists with different content; refusing to overwrite (add it to LIB_SITE_BOOTSTRAP_UPDATE to allow)" 70 ;;
        esac
    fi
    sudo -n install -D -m "$mode" -o root -g root "$src" "$dst"
    log "$verb $dst (mode $mode)"
}

# install_content DST MODE <<< content — same rule, for generated one-liners.
install_content() {
    local dst="$1" mode="$2" tmp
    tmp="$(mktemp)"
    cat >"$tmp"
    install_file "$tmp" "$dst" "$mode"
    rm -f "$tmp"
}

# ensure_symlink TARGET LINK
ensure_symlink() {
    local target="$1" link="$2"
    if [[ -L $link ]]; then
        [[ $(readlink "$link") == "$target" ]] || die "$link points elsewhere ($(readlink "$link")); refusing" 70
        log "unchanged $link"
    elif [[ -e $link ]]; then
        die "$link exists and is not a symlink; refusing" 70
    else
        sudo -n ln -s "$target" "$link"
        log "linked $link -> $target"
    fi
}

# ── 1. kyanite binary ────────────────────────────────────────────────────────
[[ -d $KYANITE_REPO/.git ]] || die "kyanite checkout not found at $KYANITE_REPO"
head="$(git -C "$KYANITE_REPO" rev-parse HEAD)"
if [[ -n $(git -C "$KYANITE_REPO" status --porcelain) ]]; then
    head="$head-dirty"
    log "WARNING: $KYANITE_REPO has uncommitted changes; recording $head"
fi
installed=""
[[ -f $KYANITE_COMMIT_FILE ]] && installed="$(cat "$KYANITE_COMMIT_FILE")"
if [[ -x $KYANITE_BIN && $installed == "$head" ]]; then
    log "kyanite $head already installed at $KYANITE_BIN"
else
    # cargo lives in ~/.cargo/bin, which a non-login `bash -s` shell does not have.
    [[ -f $HOME/.cargo/env ]] && . "$HOME/.cargo/env"
    command -v cargo >/dev/null || die "cargo not found"
    log "building kyanite at $head"
    # ~/.local/bin/cc on vultr is a Claude Code launcher that shadows the C
    # compiler (measured: `cc -m64` → "unknown option"). Pin the real one for
    # both build scripts and the final link.
    (cd "$KYANITE_REPO" && \
        CC=/usr/bin/cc CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=/usr/bin/cc \
        cargo build --release --bin kyanite)
    sudo -n install -m 0755 -o root -g root "$KYANITE_REPO/target/release/kyanite" "$KYANITE_BIN"
    sudo -n install -d -m 0755 -o root -g root "$(dirname "$KYANITE_COMMIT_FILE")"
    printf '%s\n' "$head" | sudo -n tee "$KYANITE_COMMIT_FILE" >/dev/null
    log "installed $KYANITE_BIN ($("$KYANITE_BIN" --version), commit $head)"
fi

# ── 2. state directory ───────────────────────────────────────────────────────
for dir in "$STATE_DIR" "$STATE_DIR/nginx"; do
    if [[ -d $dir ]]; then
        log "exists $dir"
    else
        sudo -n install -d -m 0755 -o "$OWNER" -g "$OWNER" "$dir"
        log "created $dir ($OWNER, 0755)"
    fi
done

# ── 3. nginx include for kyanite's route files ───────────────────────────────
install_content /etc/nginx/conf.d/kyanite.conf 0644 <<'CONF'
# kyanite publishes one `listen 80` server block per live tenant here.
# Installed by lib-site deploy/vultr-bootstrap.sh; do not edit by hand.
include /var/lib/kyanite/nginx/*.conf;
CONF

# ── 4. front vhost, nginx shim, CI forced command ────────────────────────────
[[ -d $SRC ]] || die "deploy source directory $SRC not found (set LIB_SITE_DEPLOY_SRC)"
install_file "$SRC/nginx/lib.minamorl.com.conf" /etc/nginx/sites-available/lib.minamorl.com 0644
ensure_symlink /etc/nginx/sites-available/lib.minamorl.com /etc/nginx/sites-enabled/lib.minamorl.com
install_file "$SRC/kyanite-nginx" /usr/local/bin/kyanite-nginx 0755
install_file "$SRC/lib-site-ci-deploy" /usr/local/bin/lib-site-ci-deploy 0755

# ── 5. validate, then reload ─────────────────────────────────────────────────
if sudo -n /usr/sbin/nginx -t; then
    sudo -n systemctl reload nginx
    log "nginx reloaded"
else
    die "nginx -t failed; not reloading" 71
fi

# ── 6. deploy checkout ───────────────────────────────────────────────────────
if [[ -d $CHECKOUT/.git ]]; then
    log "exists $CHECKOUT"
else
    git clone "$CHECKOUT_REMOTE" "$CHECKOUT"
    log "cloned $CHECKOUT"
fi

log "done (kyanite $(cat "$KYANITE_COMMIT_FILE"))"
