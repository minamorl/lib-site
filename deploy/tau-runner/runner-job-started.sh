#!/bin/bash
# Audited v2.338.0 DefaultStepHost starts this shell directly from Runner.Worker.
# A failed pre-step alone leaves if:always() eligible. Stop only this worker on
# every abnormal guard/interpreter exit; never signal the listener or a group.
set -euo pipefail
readonly worker_pid=$PPID
stop_worker() {
    # A signal trap must not re-enter EXIT and signal the PID a second time.
    trap - EXIT HUP INT TERM
    /bin/kill -KILL "$worker_pid"
    exit 1
}
trap stop_worker EXIT HUP INT TERM
/usr/bin/python3 -I /usr/local/libexec/github-runner-lib-site/runner-admission.py
trap - EXIT HUP INT TERM
