// Parallel branches start from the same base snapshot and are joined with
// Merge.strict, a three-way merge over (base, left, right).
import assert from 'node:assert/strict';
import { berylx, Err, Merge, Ok, Parallel } from '@minamorl/berylx';

interface Profile {
  user: { name: string; age: number | null };
  total: number;
  status: 'paid' | 'trial' | null;
}

const b = berylx<Profile>();
const base: Profile = { user: { name: '', age: null }, total: 0, status: null };

// Disjoint updates, including nested ones, are both preserved.
const setName = b.task('set_name', (f) => f.at('user').at('name').set('mina'));
const setAge = b.task('set_age', (f) => f.at('user').at('age').set(17));
const setTotal = b.task('set_total', (f) => f.at('total').set(42));

const disjoint = b.flow(base).call(setName.par(setAge).par(setTotal));
assert.ok(disjoint instanceof Ok);
assert.deepEqual(disjoint.focus.toObject(), {
  user: { name: 'mina', age: 17 },
  total: 42,
  status: null,
});

// A branch that changes nothing does not erase the other branch's work.
const noop = b.task('noop', (f) => f);
const identity = b.flow(base).call(noop.par(setTotal));
assert.ok(identity instanceof Ok);
assert.equal(identity.focus.at('total').get(), 42);

// Incompatible updates to the same path are a merge_conflict Err. The result
// keeps the base snapshot, not either branch's version.
const paid = b.task('paid', (f) => f.at('status').set('paid'));
const trial = b.task('trial', (f) => f.at('status').set('trial'));

const conflict = b.flow(base).call(paid.par(trial));
assert.ok(conflict instanceof Err);
assert.equal(conflict.code, 'merge_conflict');
assert.equal(conflict.failedNode, 'parallel');
assert.deepEqual(conflict.error.metadata.path, ['status']);
assert.deepEqual(conflict.focus.toObject(), base);

// Matching updates to the same path are accepted.
const paidAgain = b.task('paid_again', (f) => f.at('status').set('paid'));
const agreed = b.flow(base).call(paid.par(paidAgain));
assert.ok(agreed instanceof Ok);
assert.equal(agreed.focus.at('status').get(), 'paid');

// Merge.deep is a two-way, right-biased merge that ignores the base. It must
// be selected explicitly; here it silently drops the left branch's update.
const rightWins = b.flow(base).call(new Parallel([setTotal, setName]).reduce(Merge.deep()));
assert.ok(rightWins instanceof Ok);
assert.deepEqual(rightWins.focus.toObject(), { ...base, user: { name: 'mina', age: null } });

// Error policy: short_circuit (default) returns the first Err in branch order;
// accumulate collects every failure into parallelErrors. par() is typed as
// BerylxNode, so build a Parallel directly when you need accumulate or reduce.
const boom = b.task('boom', () => {
  throw new Error('kaboom');
});
const invalid = b.task('invalid', (f) => f.reject('invalid', 'bad input'));

const first = b.flow(base).call(boom.par(invalid));
assert.ok(first instanceof Err);
assert.equal(first.failedNode, 'boom');
assert.equal(first.parallelErrors.length, 0);

const all = b.flow(base).call(new Parallel([boom, invalid]).accumulate());
assert.ok(all instanceof Err);
assert.equal(all.code, 'parallel_failed');
assert.deepEqual(
  all.parallelErrors.map((e) => e.code),
  ['Error', 'invalid'],
);

console.log('parallel-merge ok');
