# Provider execution

Margin owns chat history in SQLite. Provider adapters execute independent requests;
they do not own or resume conversations. Claude CLI, Codex app-server, Antigravity
CLI, and OpenAI-compatible HTTP profiles share the same internal contract.

## Boundaries

- `providers/registry.ts` captures the selected profile, executable, model, and
  credentials. Credentials stay in main-process adapter state and never enter
  message records, renderer state, or curated error diagnostics.
- Each adapter reports capabilities, executes a `ProviderRequest`, and disposes of
  owned resources. Requests identify the task, deadline, signal, instructions,
  role-tagged history, paper context, and prepared attachments. A compatibility
  prompt preserves the current CLI/HTTP request format.
- Streaming events carry text only. The execution promise returns one completed,
  cancelled, or failed result. Failures have a normalized category and curated
  message; rate-limit responses can retain retry information. No automatic retries
  occur after a provider may have accepted a request.
- `executionCoordinator.ts` owns active requests, window/thread exclusion, and
  process-local generation tokens. It tracks chat, title, and tagging executions.
- `chatExecution.ts` coordinates context, persistence, titles, and provider calls.
  `chatRuntime.ts` supplies SQLite, PDF, settings, and Electron-backed dependencies.
  IPC validates payloads, establishes window ownership, and forwards events.

## Lifecycle and compatibility

One interactive request may run per window, and a thread cannot receive concurrent
turns. A stopped request retains text already received. A deadline also retains
partial text. Other provider failures continue to produce an error message.

Clearing a thread (including `/clear`), clearing all chats, deleting a paper,
reloading/closing its window, or losing the renderer invalidates relevant work.
Invalid requests cannot persist replies or emit late text/title updates. Clearing
chats leaves document tagging alone; deleting a paper cancels its tagging too.
Shutdown waits for active execution cleanup. Codex uses protocol interruption with
a 350 ms grace period; CLI termination escalates after 1 second. Temporary image
files survive until the owned process closes. HTTP readers are cancelled and
released at completion or failure.

The additive SQLite migration records message outcomes as `completed`, `cancelled`,
`timed_out`, or `failed`. Existing error rows become failed; other existing rows
become completed because historical stops cannot be reconstructed. Interrupted
answers show an incomplete label after reopening. The migration is idempotent and
extends the existing database initialization path; it does not bootstrap the full
application database from scratch.

Prompt selection remains unchanged: selected text, current page, then document
fallback; at most 12,000 characters of paper context and the last 10 messages.
Custom templates, error messages in history, Markdown/math formatting, image
permissions, and current model options are preserved. Settings changes affect the
next request. Cancellation and deadlines also bound asynchronous credential
unlocking before a provider starts. Titles and tags keep their existing scheduling and remain independent
of interactive history. Unknown endpoint capabilities do not reject inputs.

## Verification

Run `npm test`, `npx tsc --noEmit`, and `npm run build`. The existing CI matrix runs
tests and production builds on Linux, Windows, and macOS. Portable fixtures use
Node processes and loopback HTTP; tests require no provider accounts or paid calls.
They exercise fragmented streams, duplicate terminal messages, failure and timeout,
forced cleanup, settings snapshots, clear/delete races, window ownership, migration,
context compatibility, and incomplete-answer rendering.

A local Linux smoke check also exercised the built Electron app with a fresh
fixture database, isolated user settings, and a fake Claude executable. It verified
chat execution and the native SQLite migration. Additional real renderer-to-main
IPC checks verified stopped and timed-out partial answers, clearing during a stream,
and reloading during a stream. These checks did not access personal history or call
a live provider.

### Fixture timing

Set `MARGIN_BENCHMARK` to a writable JSONL file path and run
`npx vitest run src/main/services/ai.test.ts`. Each provider records five samples;
the output appends to the selected file. Use a new file for each comparison.

The following medians were recorded on Linux with Node 26.2.0. “Spawn” ends at the
Node child-process spawn event; it does not measure provider readiness. The fixture
intentionally delays output by 20 ms chunks. Stop latency measures receipt of a
complete text delta through normal cancellation and cleanup; separate tests cover
unresponsive processes and forced termination.

| Fixture | Spawn ms, before → after | First text ms | Total ms | Stop ms |
| --- | --- | --- | --- | --- |
| Claude | 0.76 → 0.82 | 31.39 → 31.16 | 52.42 → 52.15 | 0.26 → 0.28 |
| Codex | 0.75 → 0.79 | 31.64 → 32.33 | 52.66 → 53.73 | 0.72 → 0.66 |
| Antigravity | 0.78 → 0.77 | 11.04 → 11.11 | 52.90 → 52.69 | 0.37 → 0.77 |

These small samples characterize local plumbing, not live-provider performance.
Authentication, provider installation compatibility, and real response latency
remain opt-in checks. Claude SDK adoption, native-session persistence, new history
budgets, capability-aware UI, and background scheduling changes are separate work.
