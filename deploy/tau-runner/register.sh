#!/usr/bin/env bash
# First registration only, before install-admission.sh locks the installation.
set -euo pipefail
umask 077
[[ $(id -un) == gh-lib-deploy ]] || exit 64
cd /srv/github-runner-lib-site
[[ ! -f .runner ]] || { echo 'Already registered; refusing replacement' >&2; exit 65; }
read -r ACTIONS_RUNNER_INPUT_TOKEN
export ACTIONS_RUNNER_INPUT_TOKEN
exec ./config.sh --unattended --disableupdate --url https://github.com/minamorl/lib-site \
    --name tau-lib-site-deploy --labels lib-site-tau-deploy --work _work
