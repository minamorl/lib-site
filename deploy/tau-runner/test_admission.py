"""Disposable-parent tests, not real untrusted GitHub jobs."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('admission', HERE / 'runner-admission.py')
admission = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admission)
MAIN = {
    'GITHUB_REPOSITORY': 'minamorl/lib-site',
    'GITHUB_REF': 'refs/heads/main',
    'GITHUB_WORKFLOW_REF': 'minamorl/lib-site/.github/workflows/deploy.yml@refs/heads/main',
    'GITHUB_EVENT_NAME': 'push',
}


class Admission(unittest.TestCase):
    def test_exact_context(self):
        self.assertTrue(admission.admitted(MAIN))
        self.assertTrue(admission.admitted({**MAIN, 'GITHUB_EVENT_NAME': 'workflow_dispatch'}))
        for key, values in {
            'GITHUB_REPOSITORY': ['attacker/lib-site', 'minamorl/unrelated'],
            'GITHUB_REF': ['refs/pull/53/merge', 'refs/pull/53/head', 'refs/heads/topic', 'refs/tags/main'],
            'GITHUB_WORKFLOW_REF': [
                'minamorl/lib-site/.github/workflows/ci.yml@refs/heads/main',
                'minamorl/lib-site/.github/workflows/deploy.yml@refs/pull/53/merge',
                'attacker/lib-site/.github/workflows/deploy.yml@refs/heads/main',
            ],
            'GITHUB_EVENT_NAME': ['pull_request', 'pull_request_target', 'schedule', 'workflow_run'],
        }.items():
            for value in values + ['', None, MAIN[key] + '\n']:
                context = {**MAIN, key: value}
                self.assertFalse(admission.admitted(context), (key, value))
        self.assertFalse(admission.admitted({}))

    def exercise_hook(self, context, broken=False, broken_interpreter=False):
        scratch = os.environ.get('ADMISSION_TEST_TMP', str(HERE))
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            root = Path(directory)
            markers = [root / name for name in ('pre', 'action', 'always')]
            hook = root / 'hook.sh'
            guard = HERE / 'runner-admission.py' if not broken else root / 'missing.py'
            script = (HERE / 'runner-job-started.sh').read_text().replace(
                '/usr/local/libexec/github-runner-lib-site/runner-admission.py', str(guard))
            if broken_interpreter:
                script = script.replace('/usr/bin/python3', str(root / 'missing-interpreter'))
            hook.write_text(script)
            # Model DefaultStepHost's direct child bash. Deliberately ignore its
            # return code and try EVERY later step, as an always() adversary would.
            parent = (
                'import pathlib,subprocess,sys; '
                'subprocess.run(["/bin/bash", "-e", sys.argv[1]]); '
                '[pathlib.Path(p).write_text("executed") for p in sys.argv[2:]]'
            )
            sentinel = subprocess.Popen([sys.executable, '-I', '-c', 'import time;time.sleep(30)'])
            try:
                result = subprocess.run(
                    [sys.executable, '-I', '-c', parent, str(hook), *map(str, markers)],
                    env={'PATH': '/usr/bin:/bin', **context}, capture_output=True,
                    text=True, timeout=10,
                )
                self.assertIsNone(sentinel.poll(), 'An unrelated sibling was killed')
                observed = [p.exists() for p in markers]
                print('hook_result ' + json.dumps({
                    'event': context.get('GITHUB_EVENT_NAME'),
                    'ref': context.get('GITHUB_REF'),
                    'repository': context.get('GITHUB_REPOSITORY'),
                    'workflow_ref': context.get('GITHUB_WORKFLOW_REF'),
                    'broken_policy': broken, 'broken_interpreter': broken_interpreter,
                    'direct_parent_exit': result.returncode,
                    'pre_action_always_markers': observed,
                    'unrelated_sibling_pid': sentinel.pid,
                    'unrelated_sibling_alive': sentinel.poll() is None,
                }), flush=True)
                return result, observed
            finally:
                sentinel.terminate()
                sentinel.wait(timeout=5)

    def test_main_push_and_manual_can_continue(self):
        for event in ('push', 'workflow_dispatch'):
            result, markers = self.exercise_hook({**MAIN, 'GITHUB_EVENT_NAME': event})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(markers, [True, True, True])
            self.assertEqual(result.stdout, 'Runner admission accepted\n')

    def test_denial_kills_only_direct_parent_before_pre_action_always(self):
        for change in (
            {'GITHUB_REF': 'refs/pull/53/merge'},
            {'GITHUB_EVENT_NAME': 'pull_request', 'GITHUB_REF': 'refs/heads/main'},
            {'GITHUB_EVENT_NAME': 'pull_request_target'},
            {'GITHUB_REPOSITORY': 'minamorl/unrelated'},
            {'GITHUB_WORKFLOW_REF': 'minamorl/lib-site/.github/workflows/ci.yml@refs/heads/main'},
            {'GITHUB_REF': 'refs/heads/topic'},
        ):
            with self.subTest(change=change):
                result, markers = self.exercise_hook({**MAIN, **change})
                self.assertEqual(result.returncode, -signal.SIGKILL)
                self.assertEqual(markers, [False, False, False])
                self.assertEqual(result.stderr, 'Runner admission refused\n')

    def test_interpreter_or_policy_failure_is_fail_stop(self):
        result, markers = self.exercise_hook(MAIN, broken=True)
        self.assertEqual(result.returncode, -signal.SIGKILL)
        self.assertEqual(markers, [False, False, False])

    def test_missing_interpreter_is_fail_stop(self):
        result, markers = self.exercise_hook(MAIN, broken_interpreter=True)
        self.assertEqual(result.returncode, -signal.SIGKILL)
        self.assertEqual(markers, [False, False, False])

    def test_job_env_spoof_at_verified_source_boundary(self):
        # This model is valid only with the exact source-hash gate below; it is
        # not a claim that fake env tests execute GitHub's message pipeline.
        job_env = {**MAIN, 'ACTIONS_RUNNER_HOOK_JOB_STARTED': '/tmp/bypass.sh',
                   'BASH_ENV': '/tmp/bypass.sh', 'PATH': '/tmp', 'LD_PRELOAD': '/tmp/bypass.so',
                   'PYTHONPATH': '/tmp', 'PYTHONHOME': '/tmp'}
        service = {'PATH': '/usr/bin:/bin', 'ACTIONS_RUNNER_HOOK_JOB_STARTED': '/fixed/guard.sh'}
        actual = {**MAIN, 'GITHUB_REF': 'refs/pull/53/merge', 'GITHUB_EVENT_NAME': 'pull_request'}
        hook_env = {}  # JobHookProvider: NEW EMPTY handler environment, not job_env.
        hook_env.update(actual)  # ScriptHandler exports GitHubContext from server message.
        self.assertNotEqual(service['ACTIONS_RUNNER_HOOK_JOB_STARTED'], job_env['ACTIONS_RUNNER_HOOK_JOB_STARTED'])
        self.assertNotIn('BASH_ENV', hook_env)
        result, markers = self.exercise_hook({**service, **hook_env})
        self.assertEqual(result.returncode, -signal.SIGKILL)
        self.assertEqual(markers, [False, False, False])

    def test_audited_source_semantics_when_sources_provided(self):
        source_dir = os.environ.get('ADMISSION_SOURCE_DIR')
        if not source_dir:
            self.skipTest('Run verify-source.py and supply ADMISSION_SOURCE_DIR for semantic source checks')
        sources = Path(source_dir)
        subprocess.run([sys.executable, '-B', str(HERE / 'verify-source.py'), '--source-dir', source_dir],
                       check=True, stdout=subprocess.DEVNULL)
        def read(name):
            return (sources / name).read_text(encoding='utf-8-sig')
        extension = read('JobExtension.cs')
        self.assertLess(extension.index('var startedHookPath = Environment.GetEnvironmentVariable'),
                        extension.index('preJobSteps.AddRange(prepareResult.ContainerSetupSteps)'))
        self.assertLess(extension.index('steps.AddRange(preJobSteps)'), extension.index('steps.AddRange(jobSteps)'))
        self.assertIn('environment: new Dictionary<string, string>', read('JobHookProvider.cs'))
        self.assertIn('handler.Environment = environment;', read('HandlerFactory.cs'))
        self.assertIn('Environment[env.Key] = env.Value;', read('ScriptHandler.cs'))
        self.assertIn('ExpressionValues["env"] = new CaseSensitiveDictionaryContextData()', read('ExecutionContext.cs'))
        self.assertNotIn('IEnvironmentContextData', read('CaseSensitiveDictionaryContextData.cs'))
        self.assertIn('IEnvironmentContextData', read('GitHubContext.cs'))
        self.assertIn('environment: null,', read('JobDispatcher.cs'))
        self.assertIn('_proc.StartInfo.UseShellExecute = false;', read('ProcessInvoker.cs'))
        self.assertIn('return await processInvoker.ExecuteAsync(', read('StepHost.cs'))
        self.assertIn('Environment.SetEnvironmentVariable(envKey, envValue);', read('ListenerProgram.cs'))

    def test_service_locks_startup_environment_and_settings(self):
        unit = (HERE / 'runner.service').read_text()
        self.assertIn('ReadOnlyPaths=/srv/github-runner-lib-site\n', unit)
        self.assertIn('BindReadOnlyPaths=/etc/github-runner-lib-site/runner.env:/srv/github-runner-lib-site/.env', unit)
        self.assertIn('ReadWritePaths=/srv/github-runner-lib-site/_work /srv/github-runner-lib-site/_diag', unit)
        self.assertIn('ACTIONS_RUNNER_HOOK_JOB_STARTED=/usr/local/libexec/github-runner-lib-site/guard.sh', unit)
        self.assertIn('--disableupdate', (HERE / 'register.sh').read_text())

    def test_active_runner_installer_refuses_before_mutation(self):
        scratch = os.environ.get('ADMISSION_TEST_TMP', str(HERE))
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            root = Path(directory)
            marker = root / 'mutation'
            for name, contents in {
                'systemctl': '#!/bin/sh\nexit 0\n',
                'install': '#!/bin/sh\ntouch "' + str(marker) + '"\nexit 1\n',
            }.items():
                (root / name).write_text(contents)
                (root / name).chmod(0o755)
            script = (HERE / 'install-admission.sh').read_text().replace(
                '[[ $EUID == 0 && $(hostname) == tau ]] || exit 64', ':')
            result = subprocess.run(['/bin/bash', '-c', script],
                                    env={'PATH': str(root) + ':/usr/bin:/bin'},
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 65)
            self.assertIn('Stop the idle repository runner', result.stderr)
            self.assertFalse(marker.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
