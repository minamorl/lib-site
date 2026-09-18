// A chain of 100,000 operations runs without growing the call stack. The
// interpreter replaces its current node in a loop instead of recursing into
// each continuation, so program length is bounded by memory, not stack depth.
import assert from 'node:assert/strict';
import { op, pure, run, runAsync, type Effect } from '@minamorl/darkcore';

// Each step is one `tick` operation whose continuation builds the next step.
function countdown(remaining: number): Effect<string> {
  return remaining === 0
    ? pure('done')
    : op('tick', remaining, (next: number) => countdown(next));
}

// For comparison: naive recursion of the same depth overflows the JS stack.
function recurse(n: number): number {
  return n === 0 ? 0 : 1 + recurse(n - 1);
}
assert.throws(() => recurse(1_000_000), RangeError);

let ticks = 0;
const result = run(countdown(100_000), {
  tick: (remaining: number) => {
    ticks += 1;
    return remaining - 1;
  },
});
assert.equal(result, 'done');
assert.equal(ticks, 100_000);

// The async interpreter is iterative too; each handler result is awaited in turn.
let asyncTicks = 0;
const asyncResult = await runAsync(countdown(10_000), {
  tick: async (remaining: number) => {
    asyncTicks += 1;
    return remaining - 1;
  },
});
assert.equal(asyncResult, 'done');
assert.equal(asyncTicks, 10_000);

console.log(`stack-safety ok (${ticks} sync ticks, ${asyncTicks} async ticks)`);
