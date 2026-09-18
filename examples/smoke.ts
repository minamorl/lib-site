// Proves the examples harness is wired up: both packages resolve under
// NodeNext, type-check, and expose their primary exports at runtime.
import assert from 'node:assert/strict';
import * as darkcore from '@minamorl/darkcore';
import * as berylx from '@minamorl/berylx';

for (const name of ['pure', 'op', 'run', 'fold', 'runAsync', 'scoped'] as const) {
  assert.equal(typeof darkcore[name], 'function', `darkcore.${name}`);
}

const doubled = darkcore.run(
  darkcore.op<number, number, number>('double', 21, (n) => darkcore.pure(n)),
  { double: (n: number) => n * 2 },
);
assert.equal(doubled, 42);

for (const name of ['Ok', 'Err', 'Focus', 'Root', 'Flow', 'Task', 'Workflow', 'run', 'task'] as const) {
  assert.ok(berylx[name] !== undefined, `berylx.${name}`);
}
assert.equal(typeof berylx.VERSION, 'string');

console.log(`darkcore ok, berylx ${berylx.VERSION} ok`);
