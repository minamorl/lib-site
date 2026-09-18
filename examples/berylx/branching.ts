// Conditional arms with When / Else. Arms are tried in order; the first
// predicate that matches wins, and Else is an unconditional fallback.
import assert from 'node:assert/strict';
import { berylx, Else, Err, Ok } from '@minamorl/berylx';

interface Shipment {
  country: string;
  weightKg: number;
  carrier: string | null;
  cost: number;
}

const b = berylx<Shipment>();

const domesticGround = b.task('domestic_ground', (f) => f.at('carrier').set('ground').at('cost').set(5));
const domesticFreight = b.task('domestic_freight', (f) => f.at('carrier').set('freight').at('cost').set(40));
const international = b.task('international', (f) => f.at('carrier').set('air').at('cost').set(60));

const route = b
  .when('domestic_light', (f) => f.at('country').get() === 'JP' && f.at('weightKg').get() < 20)
  .then(domesticGround)
  .or(b.when('domestic_heavy', (f) => f.at('country').get() === 'JP').then(domesticFreight))
  .or(Else.then(international));

const quote = (s: Shipment) => b.flow(s).call(route);

const light = quote({ country: 'JP', weightKg: 2, carrier: null, cost: 0 });
assert.ok(light instanceof Ok);
assert.deepEqual(light.focus.toObject(), { country: 'JP', weightKg: 2, carrier: 'ground', cost: 5 });

const heavy = quote({ country: 'JP', weightKg: 80, carrier: null, cost: 0 });
assert.ok(heavy instanceof Ok);
assert.equal(heavy.focus.at('carrier').get(), 'freight');

const abroad = quote({ country: 'DE', weightKg: 2, carrier: null, cost: 0 });
assert.ok(abroad instanceof Ok);
assert.equal(abroad.focus.at('carrier').get(), 'air');

// Without an Else arm, a state that matches nothing is an Err.
const partial = b.when('domestic', (f) => f.at('country').get() === 'JP').then(domesticGround);
const unmatched = b.flow({ country: 'DE', weightKg: 1, carrier: null, cost: 0 }).call(partial);
assert.ok(unmatched instanceof Err);
assert.equal(unmatched.code, 'no_branch_matched');

// A branch is an ordinary node: it composes with then like any task.
const surcharge = b.task('surcharge', (f) => f.at('cost').update((c) => c + 1));
const routed = b.flow({ country: 'JP', weightKg: 2, carrier: null, cost: 0 }).call(route.then(surcharge));
assert.ok(routed instanceof Ok);
assert.equal(routed.focus.at('cost').get(), 6);

console.log('branching ok');
