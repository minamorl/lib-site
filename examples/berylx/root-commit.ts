// Root owns committed state. pipe commits only an Ok result; an Err leaves the
// committed state where it was, while the Err itself still carries the partial
// state. Subscribers and attachRoot observe a snapshot and each commit.
import assert from 'node:assert/strict';
import { attachRoot, berylx, Err, Ok, type RootEvent } from '@minamorl/berylx';

interface Counter {
  count: number;
  log: string[];
}

const b = berylx<Counter>();

const increment = b.task('increment', (f) => f.at('count').update((n) => n + 1));
const record = b.task('record', (f) => f.at('log').update((log) => [...log, `count=${f.at('count').get()}`]));
const fail = b.task('fail', (f) => f.reject('boom', 'refused'));

const root = b.root({ count: 0, log: [] });

const events: RootEvent[] = [];
const unsubscribe = root.subscribe((event) => events.push(event));
assert.deepEqual(events, [{ type: 'snapshot', value: { count: 0, log: [] } }]);

// A successful pipe commits once, after the whole sequence succeeds.
const ok = root.pipe(increment.then(record));
assert.ok(ok instanceof Ok);
assert.deepEqual(root.state(), { count: 1, log: ['count=1'] });
assert.equal(events.length, 2);
assert.equal(events[1]?.type, 'commit');

// A failing pipe changes nothing in the root, even though earlier steps ran.
const failed = root.pipe(increment.then(record).then(fail));
assert.ok(failed instanceof Err);
assert.deepEqual(failed.focus.toObject(), { count: 2, log: ['count=1', 'count=2'] });
assert.deepEqual(root.state(), { count: 1, log: ['count=1'] });
assert.equal(events.length, 2);
assert.equal(root.history.length, 1);

unsubscribe();

// Committed state is deeply frozen; the root hands out snapshots, not references.
assert.ok(Object.isFrozen(root.state()));
assert.ok(Object.isFrozen(root.state().log));

// attachRoot projects state for a host and returns an unsubscribe function.
const seen: Array<[string, number]> = [];
const detach = attachRoot<number>(root, (count, event) => seen.push([event.type, count]), {
  select: (state) => (state as Counter).count,
});
root.pipe(increment);
detach();
root.pipe(increment);
assert.deepEqual(seen, [
  ['snapshot', 1],
  ['commit', 2],
]);
assert.equal(root.state().count, 3);

console.log('root-commit ok');
