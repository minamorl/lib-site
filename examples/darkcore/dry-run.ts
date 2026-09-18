// Turning a program into a description instead of running it. The handler map
// decides what each operation does, so a "describing" map can record the plan
// and return stand-in values, and fold's onReturn shapes the final report.
import assert from 'node:assert/strict';
import { fold, op, pure, run, type Effect, type HandlerMap } from '@minamorl/darkcore';

type Config = { target: string; artifact: string };

// A deployment described as data. The continuation after `build` needs a
// value to proceed, so a dry-run handler must return something of that shape.
function deploy(configPath: string): Effect<string> {
  return op('readConfig', configPath, (config: Config) =>
    op('build', config.artifact, (digest: string) =>
      op('upload', { target: config.target, digest }, (url: string) => pure(url)),
    ),
  );
}

// Real handlers (simulated here with in-memory state).
const uploaded: string[] = [];
const real: HandlerMap = {
  readConfig: (path: string) => ({ target: 'prod', artifact: `${path}:app` }) satisfies Config,
  build: (artifact: string) => `sha256:${artifact.length}`,
  upload: ({ target, digest }: { target: string; digest: string }) => {
    uploaded.push(digest);
    return `https://${target}.example.com/${digest}`;
  },
};
assert.equal(run(deploy('deploy.json'), real), 'https://prod.example.com/sha256:15');
assert.equal(uploaded.length, 1);

// Describing handlers: record each step, return placeholders, perform nothing.
const trace: string[] = [];
const describing: HandlerMap = {
  readConfig: (path: string) => {
    trace.push(`read config from ${path}`);
    return { target: '<target>', artifact: '<artifact>' } satisfies Config;
  },
  build: (artifact: string) => {
    trace.push(`build ${artifact}`);
    return '<digest>';
  },
  upload: ({ target, digest }: { target: string; digest: string }) => {
    trace.push(`upload ${digest} to ${target}`);
    return '<url>';
  },
};

// fold's third argument is the terminal algebra: it maps the program's final
// value to whatever the caller wants back. Here it packages value and trace.
const plan = fold(deploy('deploy.json'), describing, (url) => ({ wouldReturn: url, steps: trace }));

assert.deepEqual(plan, {
  wouldReturn: '<url>',
  steps: ['read config from deploy.json', 'build <artifact>', 'upload <digest> to <target>'],
});
// The dry run uploaded nothing.
assert.equal(uploaded.length, 1);

// fold is also just a fold: a Pure program goes straight to onReturn.
assert.equal(fold(pure(21), {}, (n) => n * 2), 42);

console.log('dry-run ok');
