import assert from 'node:assert/strict';
import { berylx, Err } from '@minamorl/berylx';
const b = berylx<{ stock: number; risk: number | null }>();
const reserve = b.task('reserve', (f) => f.at('stock').set(2));
const score = b.task('score', (f) => f.at('risk').set(0.12));
const merged = b.flow({ stock: 0, risk: null }).call(reserve.par(score));
assert.deepEqual(merged.focus.toObject(), { stock: 2, risk: 0.12 }); // base + Δleft + Δright
const clash = b.flow({ stock: 0, risk: null }).call(reserve.par(b.task('oversell', (f) => f.at('stock').set(9))));
assert.ok(clash instanceof Err && clash.code === 'merge_conflict' && clash.message === 'merge conflict at stock');
console.log('showcase/merge ok');
