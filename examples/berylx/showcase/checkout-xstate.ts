// The same checkout in XState 5.33: a state machine whose context is the
// Checkout, promise actors for the steps, a parallel state for the fork.
import assert from 'node:assert/strict';
import { assign, createActor, fromPromise, setup, waitFor } from 'xstate';
import { type Checkout, initial, afterDecline, accepted, afterAccept } from './_checkout.ts';

class CardDeclined extends Error {
  override name = 'card_declined';
}

const machine = setup({
  types: { context: {} as Checkout, input: {} as Checkout },
  actors: {
    reserveStock: fromPromise(async ({ input }: { input: Checkout }) => ({
      reserved: input.order.qty,
      warehouse: 'tokyo-2',
    })),
    scoreRisk: fromPromise(async () => 0.12),
    chargeCard: fromPromise(async ({ input }: { input: Checkout }) => {
      if (input.order.card === 'declined') throw new CardDeclined();
      return true;
    }),
  },
}).createMachine({
  context: ({ input }) => input,
  initial: 'validating',
  states: {
    validating: {
      always: [{ guard: ({ context }) => context.order.qty > 0, target: 'preparing' }, { target: 'invalid' }],
    },
    // Both regions assign into the one context; there is no base to merge against.
    preparing: {
      type: 'parallel',
      states: {
        stock: {
          initial: 'reserving',
          states: {
            reserving: {
              invoke: {
                src: 'reserveStock',
                input: ({ context }) => context,
                onDone: { target: 'done', actions: assign({ stock: ({ event }) => event.output }) },
              },
            },
            done: { type: 'final' },
          },
        },
        risk: {
          initial: 'scoring',
          states: {
            scoring: {
              invoke: {
                src: 'scoreRisk',
                onDone: { target: 'done', actions: assign({ risk: ({ event }) => event.output }) },
              },
            },
            done: { type: 'final' },
          },
        },
      },
      onDone: 'charging',
    },
    charging: {
      invoke: {
        src: 'chargeCard',
        input: ({ context }) => context,
        onDone: { target: 'notifying', actions: assign({ charged: true }) },
        onError: {
          target: 'failed',
          // The partial state is the machine's context at this moment.
          actions: assign(({ context, event }) => ({
            stock: { reserved: 0, warehouse: null },
            failure: `${(event.error as Error).name}: released ${context.stock.reserved} @ ${context.stock.warehouse}`,
          })),
        },
      },
    },
    notifying: { entry: assign({ notified: true }), always: 'placed' },
    placed: { type: 'final' },
    failed: { type: 'final' },
    invalid: { type: 'final' },
  },
});

let committed: Checkout = initial;

async function checkout(input: Checkout) {
  const actor = createActor(machine, { input }).start();
  const snapshot = await waitFor(actor, (s) => s.status === 'done');
  if (snapshot.value === 'placed') committed = snapshot.context;
  return snapshot;
}

const failed = await checkout(initial);
assert.equal(failed.value, 'failed');
assert.deepEqual(failed.context, afterDecline);
assert.deepEqual(committed, initial);

const placed = await checkout(accepted);
assert.equal(placed.value, 'placed');
assert.deepEqual(committed, afterAccept);
console.log('showcase/checkout-xstate ok');
