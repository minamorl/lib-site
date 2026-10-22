#!/usr/bin/env bash
# Install only this repository's runner account, files and unit on tau.
# Run as root on tau. Register separately; never place a registration token here.
set -euo pipefail
REPO=lib-site
ACCOUNT=gh-lib-deploy
RUNNER=/srv/github-runner-lib-site
UNIT=github-runner-lib-site.service
HOOKS=/usr/local/libexec/github-runner-lib-site
if systemctl is-active --quiet "$UNIT"; then
    echo 'Stop the idle repository runner before bootstrap' >&2; exit 65
fi
VERSION=2.338.0
SHA256=af4b794c1bc41d73d40535e3fe092a39f9679cd8d965954c2aca25a05ca41d32

[[ $(id -u) == 0 && $(hostname) == tau && $(uname -m) == x86_64 ]] || {
    echo 'Expected root on tau x86_64' >&2; exit 64;
}
for cmd in curl jq tar sha256sum ssh runuser systemctl; do command -v "$cmd" >/dev/null; done
if ! id "$ACCOUNT" >/dev/null 2>&1; then
    useradd --system --user-group --home-dir "$RUNNER" --shell /usr/sbin/nologin "$ACCOUNT"
fi
[[ $(id -Gn "$ACCOUNT") == "$ACCOUNT" ]] || {
    echo 'Runner must have only its own group' >&2; exit 65;
}
[[ $(getent passwd "$ACCOUNT" | cut -d: -f6) == "$RUNNER" ]] || exit 65
install -d -m 0700 -o "$ACCOUNT" -g "$ACCOUNT" "$RUNNER"
if [[ ! -x "$RUNNER/bin/Runner.Listener" ]]; then
    runuser -u "$ACCOUNT" -- bash -s -- "$RUNNER" "$VERSION" "$SHA256" <<'DOWNLOAD'
set -euo pipefail
umask 077
cd "$1"
archive=$(mktemp ./runner-download.XXXXXXXX.tar.gz)
trap 'rm -f -- "$archive"' EXIT
curl --fail --silent --show-error --location --retry 3 \
    "https://github.com/actions/runner/releases/download/v$2/actions-runner-linux-x64-$2.tar.gz" -o "$archive"
printf '%s  %s\n' "$3" "$archive" | sha256sum --check -
tar -xzf "$archive"
./bin/Runner.Listener --version
DOWNLOAD
fi
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
# Bootstrap now requires the adjacent admission bundle, staged root-owned.
[[ -f $source_dir/install-admission.sh && -f $source_dir/register.sh ]] || exit 65
install -d -m 0755 -o root -g root "$HOOKS"
install -m 0755 -o root -g root "$source_dir/register.sh" "$HOOKS/register.sh"
if [[ -f $RUNNER/.runner ]]; then
    "$source_dir/install-admission.sh"
else
    printf 'Bootstrap prepared %s. Register with --disableupdate, then run install-admission.sh before starting.\n' "$REPO"
fi
