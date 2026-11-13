# Testing a server module

`createTestServer()` gives you a real kernel on a fresh in-memory database, with the core module loaded
(sign-up, sessions, record store), a clock you control, cheap password hashing, a captured mail outbox and
captured logs. Nothing touches the network or the disk, so tests are fast and can run in parallel.

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestServer } from '../../testing';
import { communityModule } from './index';

test('a teacher can report a lesson', async () => {
  const t = createTestServer({ modules: [communityModule] });
  const teacher = await t.registerUser();              // signed up, email confirmed

  const res = await t.call('community.report', {       // route name from the API table; fully typed
    params: { artifactId: 'artifact-0001' },
    body: { reason: 'spam' },
    token: teacher.token,
  });
  assert.equal(res.ok, true);                          // res.status, res.data, res.error, res.headers

  t.close();
});
```

## What is on the test server

| Member | Use |
|---|---|
| `call(route, { params, query, body, token, cookie, headers, ip })` | Call a route by name. Returns `{ ok, status, data, error, headers }`; never throws for an API error. |
| `ok(route, args)` | Same, but returns `data` and throws a readable error if the call failed. Handy for set-up steps. |
| `client(token)` | The real `createTalaClient` from `@hiraia/tala-core`, wired to this server (throws `TalaApiError`). Its `syncTransport` plugs into the sync engine. |
| `request(method, path, { rawBody, headers, … })` | A raw request, for malformed input and header tests. |
| `registerUser({ email, password, displayName, uiLanguage, verified })` | Creates a teacher through the real sign-up route. Returns `{ user, id, email, password, token, cookie }`. `verified` defaults to `true`. |
| `clock.now()`, `clock.set(date)`, `clock.advance({ days, hours, minutes, seconds, ms })` | The server's only source of time. Starts at `DEFAULT_TEST_TIME` (Monday 16 Nov 2026, 08:00 Manila). It does not move by itself. |
| `db` | The `better-sqlite3` connection, for assertions on your own tables. |
| `services` | `ctx.services` as handlers see it (`records`, `mailer`, `rateLimit`, `llm`, `curriculum`). |
| `outbox()`, `mailToken(email, template)` | Mail the server "sent" (newest first), and the token from a link. |
| `logs`, `errors` | Every log entry, and the original error behind any unexpected 500 (also printed to stderr unless `quiet: true`). |
| `close()` | Stops module timers and closes the database. Call it at the end of each test. |

## Options

```ts
createTestServer({
  modules: [myModule],                       // loaded after core
  config: { limits: { pageSize: 5 } },       // deep-merged over the local defaults
  services: { llm: myFakeGateway },          // replaces a service outright
  now: '2027-06-14T00:00:00.000Z',
  quiet: true,                               // do not print unexpected errors
  withoutCore: true,                         // kernel only; registerUser() is unavailable
});
```

- Abuse limits are set very high so ordinary tests never meet them. To test a limit, set it in `config.abuse`
  and pass `ip` to `call`.
- With no `llm` module or override, `services.llm.complete()` answers `{ ok: false, reason: 'disabled' }` and
  `routeFor()` answers `'off'`. Pass your own gateway (or a fake) in `services.llm`.
- With no `curriculum` module, `getCompetencies()` returns `[]` and `versionFor()` returns `null`.
- Responses are validated against the contract by the kernel itself: a handler that returns the wrong shape
  produces a 500 and an entry in `errors`, and keys the contract does not name are stripped.
