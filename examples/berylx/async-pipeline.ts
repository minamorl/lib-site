// Asynchronous steps with AsyncTask, run through EffectTree.runAsync. Sync and
// async tasks share one workflow; parallel async branches start together and
// are merged with the same three-way join as the synchronous interpreter.
import assert from 'node:assert/strict';
import { berylx, EffectTree, Err, Ok } from '@minamorl/berylx';

interface Enrichment {
  userId: string;
  name: string;
  orders: number;
  summary: string;
}

const b = berylx<Enrichment>();

const fetchName = (id: string) => Promise.resolve(id === 'u1' ? 'Mina' : null);
const fetchOrders = (id: string) => Promise.resolve(id === 'u1' ? 3 : 0);

const loadName = b.asyncTask('load_name', async (f) => {
  const name = await fetchName(f.at('userId').get());
  return name === null ? f.reject('not_found', 'unknown user') : f.at('name').set(name);
});

const loadOrders = b.asyncTask('load_orders', async (f) => f.at('orders').set(await fetchOrders(f.at('userId').get())));

// A synchronous task can follow asynchronous ones in the same sequence.
const summarize = b.task('summarize', (f) => f.at('summary').set(`${f.at('name').get()}: ${f.at('orders').get()} orders`));

const workflow = loadName.par(loadOrders).then(summarize);
const initial: Enrichment = { userId: 'u1', name: '', orders: 0, summary: '' };

const result = await EffectTree.runAsync(workflow, initial);
assert.ok(result instanceof Ok);
assert.deepEqual(result.focus.toObject(), { userId: 'u1', name: 'Mina', orders: 3, summary: 'Mina: 3 orders' });

// runAsync does not commit. Commit the Ok explicitly to a Root.
const root = b.root(initial);
if (result instanceof Ok) root.commit(result);
assert.deepEqual(root.state(), result.focus.toObject());

// Failures behave as in the sync interpreter: partial state plus error context.
const missing = await EffectTree.runAsync(workflow, { ...initial, userId: 'nobody' });
assert.ok(missing instanceof Err);
assert.equal(missing.code, 'not_found');
assert.equal(missing.failedNode, 'load_name');
assert.equal(missing.focus.at('summary').get(), '');

// The synchronous path refuses async tasks instead of silently mis-running them.
assert.throws(() => b.flow(initial).call(loadName), /asynchronous/);

console.log('async-pipeline ok');
