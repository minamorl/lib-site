# tau deployment runner

The deploy workflow runs on the repository-only `tau-lib-site-deploy` runner with
label `lib-site-tau-deploy`. Only this repository's `.github/workflows/deploy.yml`
on `main`, for `push` or `workflow_dispatch`, is admitted. PR checks stay on
GitHub-hosted runners. Transport, deployment platform, secrets and account isolation
remain unchanged by the admission correction.

## Transport and deployment checks

The runner opens ordinary SSH to `64.176.43.103` from the home's public IPv4.
There is no Tailscale action, OAuth credential, tunnel, or Tailnet routing in this
path. A changed home WAN address or tau outage pauses deployment; Vultr console
access is the shared-host recovery path.

Keep `DEPLOY_SSH_KEY`, `DEPLOY_USER`, the verified public-IP `DEPLOY_KNOWN_HOSTS`,
and Vultr's forced command `/usr/local/bin/lib-site-ci-deploy`. That helper accepts
only `deploy <40-hex SHA>` or `status` and checks SHA ancestry on `origin/main`.
Kyanite still builds/deploys the production image and collects expired releases on
Vultr. Development and local workflow validation do not run there.

The workflow preserves concurrency and skip semantics, checks exact `live.commit`
and Kyanite live state, probes HTTPS, and removes its temporary key/pin files with
`always()`. SSH uses strict pinned host checking and an explicit identity, with
no owner key/config/agent reuse. A forced crash can bypass cleanup: an administrator
must remove this runner's stale `_work/_temp/deploy-ssh.*` before resuming.

Before replacing a host-key pin, compare tau's public-IP ed25519 scan with
`/etc/ssh/ssh_host_ed25519_key.pub` read through a trusted Vultr session or console.
A scan alone does not authenticate the host. Never log keys or secret values.

## Host admission contract

This implementation audits the **installed Linux x64 runner 2.338.0**, commit
`197ca027b90de199464dee3bb9ff198a1db60967`. `runner-hook-contract.json` pins the
primary source files and selected package binaries from its checksum-verified
GitHub release. Run `python3 -B deploy/tau-runner/verify-source.py` to verify the
upstream sources, or pass `--source-dir` for previously fetched primary material.
The installer refuses a different version, commit or selected binary hash.

The official source contract is material to security:

- `JobExtension.cs` prepares/downloads action archives and reads manifests first,
  then puts the job-start hook before container setup and action pre/main steps.
  Download/extraction is not action execution; upstream archive-parser security
  remains necessary. This is not a boundary before processing any untrusted bytes.
- `JobDispatcher.cs` starts Worker with inherited listener environment
  (`environment: null`). `JobExtension.cs` takes the hook path from that process
  environment, not the job's `env` dictionary.
- `JobHookProvider.cs` passes a **new empty** handler environment.
  `HandlerFactory.cs` assigns it without merging job env. `ScriptHandler.cs`
  exports runtime GitHub context; `ExecutionContext.cs` builds `GitHubContext`
  from the server message, separately from the job `env` dictionary. Thus the
  actual ref/repository/workflow/event reach the hook even when a job spoofs
  `GITHUB_*`, `ACTIONS_RUNNER_HOOK_JOB_STARTED`, `BASH_ENV`, PATH, loader or Python
  variables in workflow env. The hook uses host Bash and isolated host Python.
- A hook's nonzero exit by itself does **not** prevent `if: always()` execution.
  `runner-job-started.sh` captures its direct parent's PID before external commands
  and traps abnormal guard/interpreter exit or catchable termination signals.
  Its trap sends SIGKILL only to that parent: the current `Runner.Worker` directly
  launching Bash through `DefaultStepHost`/`ProcessInvoker` (`UseShellExecute=false`).
  A refused worker cannot schedule pre/action/always steps. The listener marks the
  crashed request failed; it does not execute remaining steps. An accepted hook
  removes the trap. Do not manually invoke this hook from an administrator shell;
  test it only under a disposable parent.

`runner-admission.py` compares four exact context values to fixed literals. It
reads no workflow file, payload, argument or external code. Logs use fixed messages.
Tests exercise the real shell and Python guard under a disposable trusted parent,
checking absent later markers and a surviving unrelated sibling. Env-spoof tests
model the verified source boundary; they are not a real PR/job execution. A real
allowed main run is a separate post-merge acceptance gate owned by root.

## Filesystem and startup protection

Account `gh-lib-deploy` keeps its existing UID/group, no supplementary groups, sudo,
Docker access or interactive login. Its home remains `/srv/github-runner-lib-site`.
The installation directory is root-owned, group-readable (0750); credential files
retain their runner UID and 0600 mode. Other binaries/scripts/settings are root-owned.
Within the actual service namespace the entire installation is read-only except
`_work` and `_diag`. Job temp, SSH files, action downloads and logs write there or
to private `/tmp`; no installation write is required by the deployment job.

The root-owned `/etc/github-runner-lib-site/runner.env` is bind-mounted read-only
over listener `.env`, so listener startup cannot load a job-written hook/PATH
replacement. The unit independently sets the same fixed hook. `.path`, `.runner`,
worker binaries, hook, Python policy and host interpreter are not job-writable.
The service launches the official `Runner.Listener run` directly: upstream
`run.sh` otherwise copies `run-helper.sh.template` on every startup. systemd owns
restart handling, avoiding that write to the sealed installation.

`NoNewPrivileges`, empty capabilities, `ProtectSystem=strict`, `ProtectHome`,
private tmp/devices, kernel/control-group protection and UMask 0077 remain active.
`/srv` is hidden except this installation; owner homes, other runners, backups,
Docker socket, `/var/backups`, `/mnt`, `/media` stay inaccessible. The runner can
reach the network. A persistent self-hosted runner is not a disposable VM or a
boundary against a malicious trusted main administrator or an upstream runner flaw.

## Existing registration: stopped-runner maintenance

Do not rerun registration or replace credentials. Stage the adjacent tracked bundle
root-owned on tau, outside the job-writable installation. Use a repository-specific
staging directory under `/usr/local/libexec/github-runner-lib-site/` and delete only
that staging directory after verification. No tokens, PAT or OAuth are required.

1. Check the repository runner is online with `busy: false`. Close the check/stop
   race by freezing **only** `github-runner-lib-site.service`, checking its cgroup
   contains no `Runner.Worker`, and thawing/refusing if one is present. On this
   host systemd 259 refuses stop while frozen: SIGSTOP only the confirmed idle
   listener, thaw the unit, then stop only this service. systemd delivers SIGTERM
   and SIGCONT during stop; do not resume a listener for normal jobs before sealing.
2. Run root-owned `install-admission.sh` from that staged bundle. It refuses an
   active service and preserves registration fields/credentials, setting only
   `disableUpdate=true`. It installs the guard, policy, fixed env and unit, seals
   the installation, and runs `systemd-analyze verify`. It does not start/stop
   services itself and does not touch another repository's account/service.
3. Start the same service. Verify unchanged registration/UID/groups/labels,
   source/package hashes, read-only mount denial, writable work/log/temp paths,
   fixed selected hook environment, online/idle state and absence of test processes.
4. Root observes a real new main deploy, including its admission log, exact live
   SHA, HTTPS and SSH cleanup. Do not use an actual untrusted PR as a test.

## First-time bootstrap

Stage the whole bundle root-owned on tau. Run `install.sh` there to create/download
only this repository's account and checksum-verified runner. Registration is a
separate first-time step before sealing; `register.sh` refuses an existing `.runner`.
Pipe the one-hour GitHub registration token directly to it as the dedicated UID:

```sh
set -o pipefail
gh api -X POST repos/minamorl/lib-site/actions/runners/registration-token --jq .token |
  ssh tau 'sudo -n runuser -u gh-lib-deploy -- /usr/local/libexec/github-runner-lib-site/register.sh'
```

Then run `install-admission.sh` as root and start the service. The supported runner
input is `ACTIONS_RUNNER_INPUT_TOKEN`; the token stays in stdin/process memory,
never an argument or file. Registration uses `--disableupdate`. `install.sh` no
longer accepts the old single-script stdin bootstrap: it needs its adjacent bundle.

## Audited update policy and limits

Automatic update is explicitly disabled because replacing code would invalidate
this reviewed parent/environment/order contract and fail the read-only mount.
This is an operator maintenance obligation, not an indefinite version freeze.
GitHub normally requires a disabled-auto-update runner to be updated within
**30 days** of a release, and may block job assignment sooner for a critical fix.
Plan the next source/package review within that window; monitor the runner release
and assignment errors. Never remove admission to restore availability.

For a supported manual update, first review the new official source/tag/commit and
re-run its parent/timing/env tests. Update this bundle's version/commit, release
checksum, source and binary contract hashes together. During an idle/stopped window,
verify the new official archive and unpack it as the administrator into this
root-owned installation, preserving `.runner`, `.credentials*` and existing private
work/log state. Do not re-register or copy another account's keys. Apply the updated
admission installer (which must accept the new audited version), restore the same
read-only mounts/ownership and disabled-update setting, then verify namespace tests,
online status and a real allowed main job. If authentication migration requires a
settings/credential write outside current writable paths, use the same reviewed,
stopped maintenance window; this unit deliberately does not grant general settings
writes to jobs. A mismatched binary/version stops the installer before sealing;
a failed maintenance gate leaves this runner stopped for repair.

## Primary references

- [Audited upstream commit](https://github.com/actions/runner/tree/197ca027b90de199464dee3bb9ff198a1db60967)
- [GitHub runner job hooks](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/run-scripts)
- [GitHub runner update requirements](https://docs.github.com/en/actions/reference/runners/self-hosted-runners#runner-software-updates-on-self-hosted-runners)
- [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use)
- [systemd filesystem sandbox](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)
- [systemctl freeze/thaw](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html)
