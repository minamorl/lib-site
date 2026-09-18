// Look at a workflow's structure without executing it: Graph for the shape,
// EffectTree.dryRun for the plan that a given state would take.
import assert from 'node:assert/strict';
import { berylx, EffectTree, Else, Graph, Ok } from '@minamorl/berylx';

interface Signup {
  email: string;
  plan: 'free' | 'pro';
  verified: boolean;
  seats: number;
  welcomed: boolean;
}

const b = berylx<Signup>();

const verify = b.task('verify_email', (f) => f.at('verified').set(true));
const allocateSeats = b.task('allocate_seats', (f) => f.at('seats').set(5));
const singleSeat = b.task('single_seat', (f) => f.at('seats').set(1));
const welcome = b.task('welcome', (f) => f.at('welcomed').set(true));
const audit = b.task('audit', (f) => f);

const planArm = b
  .when('is_pro', (f) => f.at('plan').get() === 'pro')
  .then(allocateSeats)
  .or(Else.then(singleSeat));

const signup = verify.then(planArm).then(welcome.par(audit));

// Graph: every leaf task, the parallel groups, and DOT / Mermaid renderings.
const graph = Graph.from(signup, 'signup');
assert.deepEqual(graph.nodes(), ['verify_email', 'allocate_seats', 'single_seat', 'welcome', 'audit']);
assert.deepEqual(graph.parallelNodes(), [['welcome', 'audit']]);

const mermaid = graph.toMermaid();
assert.equal(mermaid.split('\n')[0], 'flowchart TD');
assert.match(mermaid, /\|is_pro\|/);
assert.match(mermaid, /\|else\|/);

const dot = graph.toDot();
assert.match(dot, /^digraph "signup" \{/);
assert.match(dot, /"split#\d+" -> "welcome#\d+";/);

// Dry run: task names in execution order for this state. Predicates are
// evaluated, task bodies are not, and the returned state is unchanged.
const pro: Signup = { email: 'a@example.com', plan: 'pro', verified: false, seats: 0, welcomed: false };
const proPlan = EffectTree.dryRun(signup, pro);
assert.deepEqual(proPlan.steps, ['verify_email', 'allocate_seats', 'welcome', 'audit']);
assert.ok(proPlan.result instanceof Ok);
assert.deepEqual(proPlan.result.focus.toObject(), pro);

const freePlan = EffectTree.dryRun(signup, { ...pro, plan: 'free' });
assert.deepEqual(freePlan.steps, ['verify_email', 'single_seat', 'welcome', 'audit']);

// The real run follows the same plan and changes the state.
const real = b.flow(pro).call(signup);
assert.ok(real instanceof Ok);
assert.deepEqual(real.focus.toObject(), { ...pro, verified: true, seats: 5, welcomed: true });

console.log('inspect ok');
