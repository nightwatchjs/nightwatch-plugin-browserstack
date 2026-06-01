/**
 * Per-process monotonic log sequence (SDK-6164).
 *
 * Every LogCreated log event (TEST_LOG, HTTP, TEST_SCREENSHOT) carries a
 * `sequence` integer drawn from this single per-process counter. It gives the
 * Test Observability backend a deterministic tiebreaker when two logs share the
 * same millisecond `timestamp`: the server sorts by (timestamp, sequence).
 *
 * The counter is intentionally global-per-process (not scoped per test_run_uuid)
 * so that all logs emitted by a worker — across tests, HTTP, and screenshots —
 * share one strictly-increasing emission order. Each parallel worker process has
 * its own counter starting at 0, matching the ticket's "per-process" design.
 */
let counter = 0;

module.exports = {
  next: () => counter++,
  // test-only hook
  _reset: () => { counter = 0 }
};
