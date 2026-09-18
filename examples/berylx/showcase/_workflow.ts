import { AsyncTask, berylx, BerylxError } from '@minamorl/berylx';
import type { Checkout } from './_checkout.ts';

const b = berylx<Checkout>();

// Deterministic in-memory service stand-ins; no payment or inventory API is called.
const validate = b.task('validate', (f) => (f.at('order').at('qty').get() > 0 ? f : f.reject('invalid_qty')));
const reserve = AsyncTask.of<Checkout>('reserve', async (f) =>
  f.at('stock').set({ reserved: f.at('order').at('qty').get(), warehouse: 'tokyo-2' }),
);
const score = AsyncTask.of<Checkout>('score_risk', async (f) => f.at('risk').set(0.12));
const charge = AsyncTask.of<Checkout>('charge', async (f) =>
  f.at('order').at('card').get() === 'declined' ? f.reject('card_declined') : f.at('charged').set(true),
);
const notify = AsyncTask.of<Checkout>('notify', async (f) => f.at('notified').set(true));

// Application-written recovery, with the state at the failing node.
// Real inventory compensation needs an external call and its own failure policy.
const release = b.catch('release', null, {}, (cause, f) => {
  const { reserved, warehouse } = f.at('stock').get();
  return f
    .at('stock').set({ reserved: 0, warehouse: null })
    .at('failure').set(`${BerylxError.from(cause).code}: released ${reserved} @ ${warehouse}`)
    .reject('checkout_failed', 'order not placed', { cause });
});

// showcase:composition:start
const checkout = validate
  .then(reserve.par(score))
  .then(charge)
  .then(release)
  .then(notify);
// showcase:composition:end

export { checkout };
