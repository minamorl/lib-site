#!/usr/bin/env bash
# Install only this repository's runner account, files and unit on tau.
# Run as root on tau. Register separately; never place a registration token here.
set -euo pipefail
REPO=lib-site
ACCOUNT=gh-lib-deploy
RUNNER=/srv/github-runner-lib-site
UNIT=github-runner-lib-site.service
HOOKS=/usr/local/libexec/github-runner-lib-site
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
install -d -m 0755 -o root -g root "$HOOKS"
cat > "$HOOKS/guard.sh" <<GUARD
#!/usr/bin/env bash
set -euo pipefail
[[ \${GITHUB_REPOSITORY:-} == minamorl/$REPO &&
   \${GITHUB_REF:-} == refs/heads/main &&
   \${GITHUB_WORKFLOW_REF:-} == minamorl/$REPO/.github/workflows/deploy.yml@refs/heads/main ]] || {
    echo 'Runner accepts only this repository main deployment workflow' >&2; exit 64;
}
case \${GITHUB_EVENT_NAME:-} in
    push|workflow_dispatch) ;;
    *) echo 'Runner refuses this event' >&2; exit 64 ;;
esac
GUARD
cat > "$HOOKS/register.sh" <<REGISTER
#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ \$(id -un) == $ACCOUNT ]] || exit 64
read -r ACTIONS_RUNNER_INPUT_TOKEN
export ACTIONS_RUNNER_INPUT_TOKEN
cd $RUNNER
exec ./config.sh --unattended --url https://github.com/minamorl/$REPO \
    --name tau-$REPO-deploy --labels $REPO-tau-deploy --work _work
REGISTER
chmod 0755 "$HOOKS/guard.sh" "$HOOKS/register.sh"
cat > "/etc/systemd/system/$UNIT" <<UNITFILE
[Unit]
Description=Repository-only $REPO deploy runner on tau
Wants=network-online.target
After=network-online.target
ConditionPathExists=$RUNNER/.runner

[Service]
Type=simple
User=$ACCOUNT
Group=$ACCOUNT
WorkingDirectory=$RUNNER
ExecStart=$RUNNER/run.sh
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=ACTIONS_RUNNER_HOOK_JOB_STARTED=$HOOKS/guard.sh
UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$RUNNER
TemporaryFileSystem=/srv:ro
BindPaths=$RUNNER
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes
LockPersonality=yes
CapabilityBoundingSet=
InaccessiblePaths=-/run/docker.sock -/run/containerd -/var/backups -/mnt -/media
Restart=always
RestartSec=10
KillMode=control-group
TimeoutStopSec=45

[Install]
WantedBy=multi-user.target
UNITFILE
systemd-analyze verify "/etc/systemd/system/$UNIT"
systemctl daemon-reload
# Do not start until repository registration has succeeded.
printf 'Installed %s; registration/start are separate.\n' "$UNIT"
id "$ACCOUNT"
