// Merge.strict is a state-based three-way join: it compares snapshots, not the
// operations that produced them. A counter incremented in parallel therefore
// loses updates; per-contributor paths keep every contribution.
import assert from 'node:assert/strict';
import { berylx, Ok } from '@minamorl/berylx';

interface Post {
  likes: number;
  likedBy: { mina: boolean; ren: boolean; sora: boolean };
}

const b = berylx<Post>();
const base: Post = { likes: 0, likedBy: { mina: false, ren: false, sora: false } };

// Every branch reads likes = 0 from the base and writes 1. The three writes
// agree, so the join accepts them as one update: the result is 1, not 3.
const like = (name: string) => b.task(name, (f) => f.at('likes').update((n) => n + 1));

const counted = b.flow(base).call(like('mina').par(like('ren')).par(like('sora')));
assert.ok(counted instanceof Ok);
assert.equal(counted.focus.at('likes').get(), 1);

// Give each contribution its own path. The writes are now disjoint, so all of
// them survive, and the total is derived from the state after the join.
const likeAs = (user: keyof Post['likedBy']) =>
  b.task(`like_${user}`, (f) => f.at('likedBy').at(user).set(true));
const tally = b.task('tally', (f) =>
  f.at('likes').set(Object.values(f.at('likedBy').get()).filter(Boolean).length),
);

const recorded = b
  .flow(base)
  .call(likeAs('mina').par(likeAs('ren')).par(likeAs('sora')).then(tally));
assert.ok(recorded instanceof Ok);
assert.deepEqual(recorded.focus.toObject(), {
  likes: 3,
  likedBy: { mina: true, ren: true, sora: true },
});

console.log('parallel-counter ok');
