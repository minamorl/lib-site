#!/usr/bin/env bash
# Existing registration maintenance. Stage this bundle root-owned first.
# Never stops/starts a runner; caller must check idle and stop this service.
set -euo pipefail
[[ $EUID == 0 && $(hostname) == tau ]] || exit 64
REPO=lib-site
ACCOUNT=gh-lib-deploy
RUNNER=/srv/github-runner-lib-site
UNIT=github-runner-lib-site.service
HOOKS=/usr/local/libexec/github-runner-lib-site
CONFIG=/etc/github-runner-lib-site
if systemctl is-active --quiet "$UNIT"; then
    echo 'Stop the idle repository runner before installing admission' >&2
    exit 65
fi
[[ $(id -Gn "$ACCOUNT") == "$ACCOUNT" ]] || exit 65
[[ $(getent passwd "$ACCOUNT" | cut -d: -f6) == "$RUNNER" ]] || exit 65
[[ -f $RUNNER/.runner && -f $RUNNER/.credentials ]] || exit 65
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
# Refuse job-owned staging files or directories, including this installer.
for path in "$source_dir" "$source_dir"/*; do
    [[ $(stat -c %u "$path") == 0 ]] || exit 65
    [[ ! -L $path ]] || exit 65
    mode=$(stat -c %a "$path")
    (( (8#$mode & 0022) == 0 )) || exit 65
done
/usr/bin/python3 -I - "$source_dir/runner-hook-contract.json" "$RUNNER" <<'VERIFY'
import hashlib, json, sys
from pathlib import Path
contract = json.loads(Path(sys.argv[1]).read_text())
for name, expected in contract['package']['files'].items():
    actual = hashlib.sha256(Path(sys.argv[2], name).read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit('Installed runner binary mismatch: ' + name)
    print(actual, name)
VERIFY
[[ $(runuser -u "$ACCOUNT" -- "$RUNNER/bin/Runner.Listener" --version) == 2.338.0 ]] || exit 65
[[ $(runuser -u "$ACCOUNT" -- "$RUNNER/bin/Runner.Listener" --commit) == 197ca027b90de199464dee3bb9ff198a1db60967 ]] || exit 65
install -d -m 0755 -o root -g root "$HOOKS" "$CONFIG"
install -m 0755 -o root -g root "$source_dir/runner-job-started.sh" "$HOOKS/guard.sh"
install -m 0644 -o root -g root "$source_dir/runner-admission.py" "$HOOKS/runner-admission.py"
install -m 0755 -o root -g root "$source_dir/register.sh" "$HOOKS/register.sh"
install -m 0644 -o root -g root "$source_dir/runner.env" "$CONFIG/runner.env"
install -m 0644 -o root -g root "$source_dir/runner.service" "/etc/systemd/system/$UNIT"
install -d -m 0700 -o "$ACCOUNT" -g "$ACCOUNT" "$RUNNER/_work" "$RUNNER/_diag"
# No registration/identity/secret fields change. Only pin the audited update policy.
/usr/bin/python3 -I - "$RUNNER/.runner" <<'PY'
import json, sys
from pathlib import Path
path = Path(sys.argv[1])
config = json.loads(path.read_text(encoding='utf-8-sig'))
config['disableUpdate'] = True
path.write_text(json.dumps(config, indent=2) + '\n')
PY
# Keep credential files mode 0600 with their existing runner UID. All other
# installation/settings files are root-owned; job writes are also mount-denied.
find "$RUNNER" -mindepth 1 -maxdepth 1 \
    ! -name _work ! -name _diag ! -name '.credentials*' \
    -exec chown -R root:"$ACCOUNT" {} +
chown root:"$ACCOUNT" "$RUNNER"
chmod 0750 "$RUNNER"
chmod -R g+rX "$RUNNER/bin" "$RUNNER/externals"
for name in .runner .env .path; do
    [[ ! -f $RUNNER/$name ]] || chmod 0640 "$RUNNER/$name"
done
systemd-analyze verify "/etc/systemd/system/$UNIT"
systemctl daemon-reload
printf 'Admission installed for %s; service remains stopped.\n' "$REPO"
