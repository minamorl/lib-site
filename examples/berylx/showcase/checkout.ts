import assert from 'node:assert/strict';
import { Root, EffectTree, BerylxError, Err, Ok } from '@minamorl/berylx';
import { initial, afterDecline, accepted, afterAccept } from './_checkout.ts';
import { checkout } from './_workflow.ts';

const root = Root.of(initial);
const result = await EffectTree.runAsync(checkout, root.state());
if (result instanceof Ok) root.commit(result.focus);

assert.ok(result instanceof Err);
assert.equal(BerylxError.from(result.cause).failedNode, 'charge');
assert.deepEqual(result.focus.toObject(), afterDecline);
assert.deepEqual(root.state(), initial); // the explicit guard leaves Err uncommitted
assert.equal(result.focus.at('notified').get(), false);

const happy = Root.of(accepted);
const success = await EffectTree.runAsync(checkout, happy.state());
assert.ok(success instanceof Ok);
if (success instanceof Ok) happy.commit(success.focus);
assert.deepEqual(happy.state(), afterAccept);
console.log('showcase/checkout ok');
