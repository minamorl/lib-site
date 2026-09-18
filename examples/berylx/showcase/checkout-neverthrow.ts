// The same checkout in neverthrow 8.2: every step returns a ResultAsync,
// combine for the fork, orElse for the compensation.
import assert from 'node:assert/strict';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import { type Checkout, initial, afterDecline, accepted, afterAccept } from './_checkout.ts';

class InvalidQty extends Error {
  override name = 'invalid_qty';
}
class CardDeclined extends Error {
  override name = 'card_declined';
}
class CheckoutFailed extends Error {
  override name = 'checkout_failed';
  readonly state: Checkout;
  override readonly cause: CardDeclined;
  constructor(state: Checkout, cause: CardDeclined) {
    super('order not placed');
    this.state = state;
    this.cause = cause;
  }
}

const validate = (s: Checkout): ResultAsync<Checkout, InvalidQty> =>
  s.order.qty > 0 ? okAsync(s) : errAsync(new InvalidQty());
const reserveStock = (s: Checkout) => okAsync({ reserved: s.order.qty, warehouse: 'tokyo-2' });
const scoreRisk = (_s: Checkout) => okAsync(0.12);
const chargeCard = (s: Checkout): ResultAsync<boolean, CardDeclined> =>
  s.order.card === 'declined' ? errAsync(new CardDeclined()) : okAsync(true);

let committed: Checkout = initial;

const checkout = (start: Checkout) =>
  validate(start)
    .andThen((s) => ResultAsync.combine([reserveStock(s), scoreRisk(s)]).map(([stock, risk]) => ({ ...s, stock, risk })))
    .andThen((s) =>
      chargeCard(s)
        .map((charged) => ({ ...s, charged }))
        // The partial state is `s`, closed over from the previous step.
        .orElse((cause) => {
          const { reserved, warehouse } = s.stock;
          const failure = `${cause.name}: released ${reserved} @ ${warehouse}`;
          return errAsync(new CheckoutFailed({ ...s, stock: { reserved: 0, warehouse: null }, failure }, cause));
        }),
    )
    .map((s) => ({ ...s, notified: true }))
    .map((s) => (committed = s));

const failed = await checkout(initial);
assert.ok(failed.isErr() && failed.error instanceof CheckoutFailed);
assert.equal(failed.error.cause.name, 'card_declined');
assert.deepEqual(failed.error.state, afterDecline);
assert.deepEqual(committed, initial);

assert.ok((await checkout(accepted)).isOk());
assert.deepEqual(committed, afterAccept);
console.log('showcase/checkout-neverthrow ok');
