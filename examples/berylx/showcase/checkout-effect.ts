// The same checkout in Effect 3.22: errors in the type, Ref for the state,
// Effect.all for the fork, catchTag for the compensation.
import assert from 'node:assert/strict';
import { Cause, Data, Effect, Exit, Option, Ref } from 'effect';
import { type Checkout, initial, afterDecline, accepted, afterAccept } from './_checkout.ts';

class InvalidQty extends Data.TaggedError('InvalidQty') {}
class CardDeclined extends Data.TaggedError('CardDeclined') {
  readonly code = 'card_declined';
}
class CheckoutFailed extends Data.TaggedError('CheckoutFailed')<{ state: Checkout; cause: CardDeclined }> {}

const reserveStock = (s: Checkout) => Effect.promise(async () => ({ reserved: s.order.qty, warehouse: 'tokyo-2' }));
const scoreRisk = (_s: Checkout) => Effect.promise(async () => 0.12);
const chargeCard = (s: Checkout): Effect.Effect<boolean, CardDeclined> =>
  s.order.card === 'declined' ? Effect.fail(new CardDeclined()) : Effect.promise(async () => true);

let committed: Checkout = initial;

const checkout = (start: Checkout) =>
  Effect.gen(function* () {
    const state = yield* Ref.make(start);
    if (start.order.qty <= 0) return yield* new InvalidQty();
    const [stock, risk] = yield* Effect.all([reserveStock(start), scoreRisk(start)], { concurrency: 'unbounded' });
    yield* Ref.update(state, (s) => ({ ...s, stock, risk }));
    // The partial state is in the Ref; the handler reads it back out.
    const charged = yield* chargeCard(yield* Ref.get(state)).pipe(
      Effect.catchTag('CardDeclined', (cause) =>
        Effect.gen(function* () {
          const s = yield* Ref.get(state);
          const { reserved, warehouse } = s.stock;
          const failure = `${cause.code}: released ${reserved} @ ${warehouse}`;
          return yield* new CheckoutFailed({ state: { ...s, stock: { reserved: 0, warehouse: null }, failure }, cause });
        }),
      ),
    );
    yield* Ref.update(state, (s) => ({ ...s, charged, notified: true }));
    committed = yield* Ref.get(state);
    return committed;
  });

const exit = await Effect.runPromiseExit(checkout(initial));
assert.ok(Exit.isFailure(exit));
const failed = Option.getOrThrow(Cause.failureOption(exit.cause));
assert.ok(failed instanceof CheckoutFailed);
assert.equal(failed.cause._tag, 'CardDeclined');
assert.deepEqual(failed.state, afterDecline);
assert.deepEqual(committed, initial);

await Effect.runPromise(checkout(accepted));
assert.deepEqual(committed, afterAccept);
console.log('showcase/checkout-effect ok');
