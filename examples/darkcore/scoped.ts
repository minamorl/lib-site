// scoped(acquire, use, release) keeps a resource's whole lifetime in one call.
// Once acquire succeeds, release always runs and observes how `use` ended:
// a Success exit with the value, or an Error exit with the thrown value.
import assert from 'node:assert/strict';
import { scoped, scopedAsync, type ScopeExit } from '@minamorl/darkcore';

type Handle = { name: string; open: boolean };
const log: string[] = [];

function acquire(name: string): Handle {
  log.push(`open ${name}`);
  return { name, open: true };
}
function release(handle: Handle, exit: ScopeExit<unknown>): void {
  handle.open = false;
  log.push(`close ${handle.name} after ${exit._tag}`);
}

// Success: use returns, release sees { _tag: 'Success', value }.
const seen: ScopeExit<number>[] = [];
const length = scoped(
  () => acquire('a'),
  (h) => h.name.length,
  (h, exit) => {
    seen.push(exit);
    release(h, exit);
  },
);
assert.equal(length, 1);
assert.deepEqual(seen, [{ _tag: 'Success', value: 1 }]);

// Error: use throws, release still runs and sees { _tag: 'Error', error }.
const boom = new Error('disk full');
let errorExit: ScopeExit<never> | undefined;
assert.throws(
  () =>
    scoped(
      () => acquire('b'),
      (): never => {
        throw boom;
      },
      (h, exit) => {
        errorExit = exit;
        release(h, exit);
      },
    ),
  (error: unknown) => {
    // The caller receives darkcore's envelope; the original error is its cause.
    const e = error as Error & { code: string; details: Record<string, unknown> };
    assert.equal(e.code, 'SCOPE_USE_FAILED');
    assert.equal(e.cause, boom);
    assert.deepEqual(e.details, { cause: { name: 'Error', message: 'disk full' } });
    return true;
  },
);
assert.deepEqual(errorExit, { _tag: 'Error', error: boom });

assert.deepEqual(log, ['open a', 'close a after Success', 'open b', 'close b after Error']);

// If acquire itself throws, there is nothing to release; the error is SCOPE_ACQUIRE_FAILED.
assert.throws(
  () =>
    scoped(
      (): Handle => {
        throw new Error('permission denied');
      },
      () => 0,
      () => assert.fail('release must not run when acquire fails'),
    ),
  (error: unknown) => (error as { code?: unknown }).code === 'SCOPE_ACQUIRE_FAILED',
);

// scopedAsync: promises cannot be forcibly cancelled, so cancellation is a
// cooperative rejection. An AbortError takes the error release path and the
// caller sees SCOPE_CANCELLED instead of SCOPE_USE_FAILED.
const controller = new AbortController();
let asyncExit: ScopeExit<unknown> | undefined;
await assert.rejects(
  scopedAsync(
    async () => acquire('c'),
    async (h) => {
      controller.abort();
      controller.signal.throwIfAborted(); // throws a DOMException named AbortError
      return h.name;
    },
    async (h, exit) => {
      asyncExit = exit;
      release(h, exit);
    },
  ),
  (error: unknown) => (error as { code?: unknown }).code === 'SCOPE_CANCELLED',
);
assert.equal(asyncExit?._tag, 'Error');
assert.equal(log.at(-1), 'close c after Error');

console.log('scoped ok');
