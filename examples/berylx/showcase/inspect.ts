import assert from 'node:assert/strict';
import { EffectTree, Graph } from '@minamorl/berylx';
import { initial } from './_checkout.ts';
import { checkout } from './_workflow.ts';

// Structure, before anything runs.
const graph = Graph.from(checkout, 'checkout');
assert.deepEqual(graph.nodes(), ['validate', 'reserve', 'score_risk', 'charge', 'release', 'notify']);
assert.deepEqual(graph.parallelNodes(), [['reserve', 'score_risk']]);
console.log(graph.toMermaid());

// Structural traversal: tasks act as successful identities, so release is skipped.
const plan = EffectTree.dryRun(checkout, initial);
assert.deepEqual(plan.steps, ['validate', 'reserve', 'score_risk', 'charge', 'notify']);
assert.deepEqual(plan.result.focus.toObject(), initial);
console.log('showcase/inspect ok');
