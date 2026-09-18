import assert from 'node:assert/strict';
import { type Checkout, initial, afterDecline, accepted, afterAccept } from './_checkout.ts';

class CardDeclined extends Error {
  override name = 'card_declined';
}

// Deterministic in-memory service stand-ins, matching the berylx example.
async function reserveStock(s: Checkout): Promise<Checkout> {
  return { ...s, stock: { reserved: s.order.qty, warehouse: 'tokyo-2' } };
}
async function scoreRisk(s: Checkout): Promise<Checkout> {
  return { ...s, risk: 0.12 };
}
async function chargeCard(s: Checkout): Promise<Checkout> {
  if (s.order.card === 'declined') throw new CardDeclined();
  return { ...s, charged: true };
}

// (a) The obvious join. Both branches started from the same base, so the
// right branch still carries the base `stock`, and the spread puts it back.
const [left, right] = await Promise.all([reserveStock(initial), scoreRisk(initial)]);
const spreadMerged = { ...left, ...right };
assert.equal(left.stock.reserved, 2);
assert.equal(spreadMerged.stock.reserved, 0); // the reservation is gone

// So the join is done field by field, and the shape of Checkout is now
// duplicated in the code that merges it.
let committed: Checkout = initial;

async function checkout(state: Checkout): Promise<Checkout> {
  if (state.order.qty <= 0) throw new Error('invalid_qty');
  const [l, r] = await Promise.all([reserveStock(state), scoreRisk(state)]);
  let current: Checkout = { ...state, stock: l.stock, risk: r.risk };
  try {
    current = await chargeCard(current);
  } catch (cause) {
    // (b) The partial state lives in `current`, a local of this function.
    // Anything that wants it has to be handed it by hand.
    const { reserved, warehouse } = current.stock;
    current = {
      ...current,
      stock: { reserved: 0, warehouse: null },
      failure: `${(cause as Error).name}: released ${reserved} @ ${warehouse}`,
    };
    throw Object.assign(new Error('checkout_failed'), { cause, state: current });
  }
  current = { ...current, notified: true };
  committed = current; // (c) this function's control flow commits only on success
  return current;
}

const failed = await checkout(initial).then(
  () => assert.fail('expected the declined card to throw'),
  (e: Error & { state: Checkout; cause: Error }) => e,
);
assert.equal(failed.cause.name, 'card_declined');
assert.deepEqual(failed.state, afterDecline);
assert.deepEqual(committed, initial);

await checkout(accepted);
assert.deepEqual(committed, afterAccept);
console.log('showcase/checkout-by-hand ok');
