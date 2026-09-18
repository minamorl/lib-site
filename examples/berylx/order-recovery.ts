// A multi-step order workflow: validate -> reserve -> charge. A failure carries
// the partial state reached so far, and a Catch boundary uses that state to
// recover and let the sequence continue.
import assert from 'node:assert/strict';
import { berylx, BerylxError, Err, Ok } from '@minamorl/berylx';

interface Order {
  sku: string;
  quantity: number;
  reserved: boolean;
  charged: boolean;
  failure: string | null;
  notified: boolean;
}

const b = berylx<Order>();

const validate = b.task('validate', (f) =>
  f.at('quantity').get() > 0 ? f : f.reject('invalid_quantity', 'quantity must be positive'),
);

const reserve = b.task('reserve', (f) => f.at('reserved').set(true));

// Simulates a payment gateway that declines this particular SKU.
const charge = b.task('charge', (f) =>
  f.at('sku').get() === 'declined'
    ? f.reject('payment_failed', 'card declined')
    : f.at('charged').set(true),
);

const notify = b.task('notify', (f) => f.at('notified').set(true));

// The handler receives the underlying cause (or the BerylxError when there is
// none) and the partial focus. It can read what earlier steps already did.
const recordFailure = b.catch('record_failure', null, {}, (error, f) => {
  const code = error instanceof BerylxError ? error.code : String(error);
  return f.at('failure').set(`${code} (reserved=${f.at('reserved').get()})`);
});

const initial: Order = {
  sku: 'declined',
  quantity: 1,
  reserved: false,
  charged: false,
  failure: null,
  notified: false,
};

// 1. Without a recovery boundary: Err carries partial state and error context,
//    and the steps after the failure do not run.
const plain = b.flow(initial).call(validate.then(reserve).then(charge).then(notify));
assert.ok(plain instanceof Err);
assert.equal(plain.code, 'payment_failed');
assert.equal(plain.failedNode, 'charge');
assert.deepEqual([...plain.trace], ['charge']);
assert.deepEqual(plain.focus.toObject(), { ...initial, reserved: true });

// 2. With Catch: the handler runs, the sequence continues, and the root commits.
const root = b.root(initial);
const recovered = root.pipe(
  validate.then(reserve).then(charge).then(recordFailure).then(notify),
);
assert.ok(recovered instanceof Ok);
assert.deepEqual(recovered.focus.toObject(), {
  ...initial,
  reserved: true,
  failure: 'payment_failed (reserved=true)',
  notified: true,
});
assert.deepEqual(root.state(), recovered.focus.toObject());

// 3. Catch passes successful results through untouched.
const happy = b.flow({ ...initial, sku: 'ok' }).call(
  validate.then(reserve).then(charge).then(recordFailure).then(notify),
);
assert.ok(happy instanceof Ok);
assert.deepEqual(happy.focus.toObject(), {
  ...initial,
  sku: 'ok',
  reserved: true,
  charged: true,
  notified: true,
});

// 4. rescueWith wraps a whole sub-workflow instead of sitting inside a sequence.
const fallback = b.task('fallback', (f) => f.at('failure').set('rescued'));
const wrapped = b.flow(initial).call(validate.then(reserve).then(charge).rescueWith(fallback));
assert.ok(wrapped instanceof Ok);
assert.deepEqual(wrapped.focus.toObject(), { ...initial, reserved: true, failure: 'rescued' });

// 5. Validation failures short-circuit before any side-effecting step runs.
const invalid = b.flow({ ...initial, quantity: 0 }).call(validate.then(reserve).then(charge));
assert.ok(invalid instanceof Err);
assert.equal(invalid.code, 'invalid_quantity');
assert.equal(invalid.focus.at('reserved').get(), false);

console.log('order-recovery ok');
