# tau deployment runner

The deployment workflow uses a repository-scoped runner on tau. Its custom label
is `lib-site-tau-deploy`; the runner name is `tau-lib-site-deploy`.
Only `.github/workflows/deploy.yml` on `main`, triggered by `push` or
`workflow_dispatch`, may use it. Pull-request tests and formatting stay on
GitHub-hosted runners. This job does not check out or execute repository code.

## Transport and deployment checks

The runner opens ordinary SSH to `64.176.43.103` from the home's public IPv4.
There is no Tailscale action, OAuth credential, tunnel, or dependency on Tailnet
routing in this path. Keep the current home public IPv4 allowed in Vultr's SSH
firewall. A home WAN address change or tau outage pauses deployment until repaired;
Vultr console access is the recovery path.

The existing `DEPLOY_SSH_KEY` and `DEPLOY_USER` secrets are retained. The key is
restricted on Vultr to `/usr/local/bin/lib-site-ci-deploy`, accepting only
`deploy <40-hex SHA>` and `status`. The helper still fetches and checks the SHA
against `origin/main`, deploys through Kyanite, and collects expired releases.
The workflow keeps its concurrency group and skip semantics, then requires
`kyanite[0].latest.state == "live"`, `live.commit == GITHUB_SHA`, and HTTPS success.
Explicit Bash enables pipeline failure propagation. No production helper is changed.

Set `DEPLOY_HOST` to the public IPv4 above. Before setting `DEPLOY_KNOWN_HOSTS`,
compare the `ssh-keyscan -T 10 -t ed25519 64.176.43.103` result from tau against
`/etc/ssh/ssh_host_ed25519_key.pub` read through a trusted Vultr session or its
management console. Compare the key type and key blob, then store a known-hosts
line whose host field is the public IPv4. A scan alone is not authentication.
Never print secret values. Both SSH steps use the pinned file, strict host checking,
`IdentitiesOnly=yes`, no user SSH config, and bounded connection/keepalive timeouts.

Each job writes its key and pinned host key to a mode-0700 `mktemp` directory in
`RUNNER_TEMP`, with mode-0600 files. The `always()` cleanup removes both files and
the directory. No owner SSH identity or agent is installed in the runner account.
A host crash or forced kill can bypass cleanup; before restarting after one, remove
stale `deploy-ssh.*` directories under this runner's `_work/_temp` as an administrator.

## Installation and registration

Run the tracked installer from a trusted checkout on the administrator's Mac:

```sh
ssh tau 'sudo -n bash -s' < deploy/tau-runner/install.sh
```

It installs GitHub runner 2.338.0 for Linux x64, checking the SHA-256 supplied by
GitHub's runner-download API. It creates only this repository's system account,
runner home, root-owned hook/registration scripts, and service. Re-running preserves
an existing registration and runner installation; normal runner auto-updates remain
enabled. Audit an existing account before reusing it. It must have only its own group.

Register using a one-hour GitHub registration token piped directly to the dedicated
account. The token is consumed from stdin into the runner-supported
`ACTIONS_RUNNER_INPUT_TOKEN` process environment, never an argument or file:

```sh
set -o pipefail
gh api -X POST repos/minamorl/lib-site/actions/runners/registration-token --jq .token |
  ssh tau 'sudo -n runuser -u gh-lib-deploy -- /usr/local/libexec/github-runner-lib-site/register.sh'
ssh tau 'sudo -n systemctl enable --now github-runner-lib-site.service'
gh api repos/minamorl/lib-site/actions/runners \
  --jq '.runners[] | {name,status,busy,labels: [.labels[].name]}'
```

Do not use `--replace` against another runner. A configured runner appears online
and idle before integration; this is not an end-to-end deployment result.

## Isolation and operations

- Account `gh-lib-deploy`, home `/srv/github-runner-lib-site` (0700), own group only,
  no interactive login, sudo membership, or Docker group/socket access.
- `github-runner-lib-site.service`: `NoNewPrivileges=yes`, empty capability set,
  `ProtectSystem=strict`, `ProtectHome=yes`, `UMask=0077`, private devices/tmp,
  and kernel/control-group protection.
- `/srv` is hidden by a read-only temporary filesystem with only this runner home
  bound back writable. Other runner/source/backup directories there are absent.
  `/home`, `/root`, `/var/backups`, `/mnt`, `/media`, and the Docker socket are hidden.
- A root-owned job-start hook checks repository, exact workflow ref, branch and
  event, refusing other workflows, branches, and pull-request events.
- The runner can reach the network, and trusted main workflow changes can execute
  commands as its UID. This is a persistent process, not a disposable VM or a
  security boundary against a malicious repository administrator. Review changes
  to deployment workflows; never route PR jobs to this label.

```sh
ssh tau 'sudo -n systemctl status github-runner-lib-site.service --no-pager'
ssh tau 'sudo -n journalctl -u github-runner-lib-site.service -n 30 --no-pager'
# Stop only this runner to pause deployment; queued deploys remain queued.
ssh tau 'sudo -n systemctl stop github-runner-lib-site.service'
```

After merging, root must observe a real `main` push/dispatch run on this runner,
including the forced-key SSH authentication, exact live-commit check, HTTPS check,
and temporary-key cleanup. Do not tighten shared SSH firewall rules until that run
succeeds. If rolling back routing, retain an approved SSH source; GitHub-hosted
runner egress is not covered by the home-only rule. Kyanite's existing production
build stays on Vultr; development and local workflow validation do not run there.

## Primary references

- [GitHub runner registration](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)
- [GitHub runner REST API](https://docs.github.com/en/rest/actions/self-hosted-runners)
- [GitHub job hooks](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/run-scripts)
- [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use)
- [systemd sandbox directives](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)
