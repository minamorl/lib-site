// One program, two handler maps. The program only describes what it needs
// ("load a user", "send an email"); the handler map decides what those tags
// mean. Production supplies real handlers, a test supplies recording fakes,
// and the program itself is never edited.
import assert from 'node:assert/strict';
import { op, pure, run, type Effect, type HandlerMap } from '@minamorl/darkcore';

type User = { id: string; email: string; name: string };
type Mail = { to: string; body: string };

// The program: a plain data structure built from `op` and `pure`.
// Each continuation only builds the next node; nothing runs yet.
function welcome(userId: string): Effect<string> {
  return op('loadUser', { id: userId }, (user: User) =>
    op('sendMail', { to: user.email, body: `Welcome, ${user.name}!` }, (messageId: string) =>
      pure(`sent ${messageId} to ${user.email}`),
    ),
  );
}

// "Production" handlers backed by an in-memory table and outbox.
const users = new Map<string, User>([['u1', { id: 'u1', email: 'ada@example.com', name: 'Ada' }]]);
const outbox: Mail[] = [];
const production: HandlerMap = {
  loadUser: ({ id }: { id: string }) => {
    const user = users.get(id);
    if (user === undefined) throw new Error(`no user ${id}`);
    return user;
  },
  sendMail: (mail: Mail) => {
    outbox.push(mail);
    return `m${outbox.length}`;
  },
};

assert.equal(run(welcome('u1'), production), 'sent m1 to ada@example.com');
assert.deepEqual(outbox, [{ to: 'ada@example.com', body: 'Welcome, Ada!' }]);

// Test handlers: record every call, return canned data, touch nothing.
const calls: Array<{ tag: string; input: unknown }> = [];
const recording: HandlerMap = {
  loadUser: (input: { id: string }) => {
    calls.push({ tag: 'loadUser', input });
    return { id: input.id, email: 'test@example.invalid', name: 'Test' } satisfies User;
  },
  sendMail: (input: Mail) => {
    calls.push({ tag: 'sendMail', input });
    return 'fake-id';
  },
};

assert.equal(run(welcome('u1'), recording), 'sent fake-id to test@example.invalid');
assert.deepEqual(calls, [
  { tag: 'loadUser', input: { id: 'u1' } },
  { tag: 'sendMail', input: { to: 'test@example.invalid', body: 'Welcome, Test!' } },
]);
// The production outbox was not touched by the test run.
assert.equal(outbox.length, 1);

console.log('handlers ok');
