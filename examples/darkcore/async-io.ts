// runAsync with handlers that do real I/O: write a file, wait on a timer,
// read the file back. Handlers may return promises or plain values; the
// interpreter awaits each result before building the next node.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { op, pure, run, runAsync, type Effect, type HandlerMap } from '@minamorl/darkcore';

type WriteInput = { path: string; text: string };

// A program that round-trips text through a file, with a pause in between.
function roundTrip(path: string, text: string): Effect<{ bytes: number; text: string }> {
  return op('write', { path, text }, (bytes: number) =>
    op('sleep', 5, () =>
      op('read', path, (contents: string) => pure({ bytes, text: contents })),
    ),
  );
}

const dir = await mkdtemp(join(tmpdir(), 'darkcore-'));
const path = join(dir, 'note.txt');

const io: HandlerMap = {
  write: async ({ path, text }: WriteInput) => {
    await writeFile(path, text, 'utf8');
    return Buffer.byteLength(text);
  },
  sleep: (ms: number) => sleep(ms),
  read: (path: string) => readFile(path, 'utf8'),
};

try {
  const result = await runAsync(roundTrip(path, 'hello, file'), io);
  assert.deepEqual(result, { bytes: 11, text: 'hello, file' });

  // The same program cannot be run synchronously with these handlers:
  // the sync interpreter refuses the first promise it sees.
  assert.throws(
    () => run(roundTrip(path, 'again'), io),
    (error: unknown) =>
      error instanceof Error && (error as { code?: unknown }).code === 'ASYNC_HANDLER_IN_SYNC_RUN',
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log('async-io ok');
