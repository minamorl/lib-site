// Every failure raised by the interpreter is an Error carrying the same
// envelope: a stable `code`, a `message`, structured `details`, and a
// ULID-shaped `trace_id`. Details describe nested failures by name and
// message only; they never contain a raw stack.
import assert from 'node:assert/strict';
import { op, pure, run, runAsync } from '@minamorl/darkcore';

type Envelope = Error & {
  code: string;
  details: Readonly<Record<string, unknown>>;
  trace_id: string;
};

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function envelope(thrown: unknown): Envelope {
  assert.ok(thrown instanceof Error, 'failures are Error instances');
  const e = thrown as Envelope;
  assert.equal(typeof e.code, 'string');
  assert.equal(typeof e.message, 'string');
  assert.equal(typeof e.details, 'object');
  assert.match(e.trace_id, ULID);
  assert.equal('stack' in e.details, false, 'details never carry a raw stack');
  return e;
}

// 1. No handler for a tag.
try {
  run(op('missing', { any: 'input' }, pure), {});
  assert.fail('unreachable');
} catch (thrown) {
  const e = envelope(thrown);
  assert.equal(e.code, 'MISSING_HANDLER');
  assert.deepEqual(e.details, { tag: 'missing' });
}

// 2. A handler throws. The envelope wraps it: the original error is `cause`,
//    and details carry only its name and message.
const failure = new TypeError('bad input');
try {
  run(
    op('parse', 'x', pure),
    {
      parse: () => {
        throw failure;
      },
    },
  );
  assert.fail('unreachable');
} catch (thrown) {
  const e = envelope(thrown);
  assert.equal(e.code, 'EFFECT_RUN_FAILED');
  assert.equal(e.cause, failure);
  assert.deepEqual(e.details, { cause: { name: 'TypeError', message: 'bad input' } });
}

// 3. A promise-returning handler under the synchronous interpreter.
try {
  run(op('later', null, pure), { later: async () => 1 });
  assert.fail('unreachable');
} catch (thrown) {
  const e = envelope(thrown);
  assert.equal(e.code, 'ASYNC_HANDLER_IN_SYNC_RUN');
  assert.deepEqual(e.details, { tag: 'later' });
}

// 4. The async interpreter uses its own code for wrapped failures, and a
//    missing handler keeps MISSING_HANDLER there as well.
await assert.rejects(
  runAsync(op('fetch', 'u', pure), { fetch: async () => Promise.reject(new Error('offline')) }),
  (thrown: unknown) => {
    const e = envelope(thrown);
    assert.equal(e.code, 'EFFECT_RUN_ASYNC_FAILED');
    assert.deepEqual(e.details, { cause: { name: 'Error', message: 'offline' } });
    return true;
  },
);
await assert.rejects(runAsync(op('nope', null, pure), {}), (thrown: unknown) => {
  assert.equal(envelope(thrown).code, 'MISSING_HANDLER');
  return true;
});

// 5. Every failure gets its own trace_id.
const ids = new Set<string>();
for (let i = 0; i < 3; i += 1) {
  try {
    run(op('missing', null, pure), {});
  } catch (thrown) {
    ids.add(envelope(thrown).trace_id);
  }
}
assert.equal(ids.size, 3);

console.log('errors ok');
