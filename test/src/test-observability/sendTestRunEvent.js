const assert = require('assert');
const sinon = require('sinon');

const helper = require('../../../src/utils/helper');
const TestMap = require('../../../src/utils/testMap');
const TestObservability = require('../../../src/testObservability');

// Regression coverage for SDK-5914 / suppressNotFoundErrors.
//
// Before this fix, sendTestRunEvent walked eventData.commands for any
// status:'fail' record and flipped testData.result to 'failed' even when
// the failing command was a Nightwatch `isVisible({suppressNotFoundErrors:true})`
// lookup whose absence is an expected, callsite-opted-into outcome.
// The bug shipped because this function had no unit coverage at all.
describe('TestObservability - sendTestRunEvent (suppressNotFoundErrors)', function () {
  const buildTest = (commands, envelopeRollup = {status: 'pass', failed: 0, errors: 0}) => ({
    metadata: {
      name: 'Conditional Suite',
      tags: [],
      modulePath: '/tmp/observabilityBugRepro.js',
      host: 'hub-cloud.browserstack.com',
      sessionId: 'session-id-stub',
      sessionCapabilities: {}
    },
    testcase: 'conditional test',
    testCaseData: () => '',
    settings: {desiredCapabilities: {'bstack:options': {osVersion: '11'}}},
    envelope: {
      'conditional test': {
        startTimestamp: 1700000000000,
        testcase: {
          endTimestamp: 1700000001000,
          commands,
          ...envelopeRollup
        }
      }
    }
  });

  beforeEach(() => {
    this.sandbox = sinon.createSandbox();
    this.testObservability = new TestObservability();

    this.sandbox.stub(this.testObservability, 'getTestBody').returns('');
    this.sandbox.stub(this.testObservability, 'processTestRunData').resolves();
    this.sandbox.stub(helper, 'getCloudProvider').returns('automate');
    this.sandbox.stub(helper, 'getIntegrationsObject').returns({});
    this.sandbox.stub(helper, 'isTestObservabilitySession').returns(true);
    this.sandbox.stub(helper, 'isAccessibilitySession').returns(false);
    this.sandbox.stub(TestMap, 'getSessionSnapshot').returns(null);

    this.uploaded = null;
    this.uploadStub = this.sandbox.stub(helper, 'uploadEventData').callsFake(async (payload) => {
      this.uploaded = payload;
    });
  });

  afterEach(() => {
    this.sandbox.restore();
  });

  it('marks the test passed when the only failing command opted into suppressNotFoundErrors (args as object)', async () => {
    const commands = [
      {name: 'url', args: ['https://www.google.com'], status: 'pass'},
      {
        name: 'isVisible',
        args: [{selector: '#may-or-may-not-exist', suppressNotFoundErrors: true, timeout: 2000}, null],
        status: 'fail',
        result: {message: 'Element not found', stack: '', name: 'Error'}
      }
    ];

    await this.testObservability.sendTestRunEvent('TestRunFinished', buildTest(commands), 'uuid-1');

    sinon.assert.calledOnce(this.uploadStub);
    assert.strictEqual(this.uploaded.event_type, 'TestRunFinished');
    assert.strictEqual(this.uploaded.test_run.result, 'passed');
    assert.ok(!('failure' in this.uploaded.test_run), 'expected no failure field on passed test');
    assert.ok(!('failure_reason' in this.uploaded.test_run), 'expected no failure_reason field on passed test');
  });

  it('marks the test passed when args[0] is a JSON-encoded string carrying suppressNotFoundErrors', async () => {
    // Some Nightwatch reporter paths serialize the options object to a JSON
    // string in command.args[0] — the customer's CHROME_148__observabilityBugRepro.json
    // is the canonical example. The fix must handle both shapes.
    const commands = [
      {
        name: 'isVisible',
        args: ['{"selector":"#may-or-may-not-exist","suppressNotFoundErrors":true,"timeout":2000}', null],
        status: 'fail',
        result: {message: 'Element not found', stack: ''}
      }
    ];

    await this.testObservability.sendTestRunEvent('TestRunFinished', buildTest(commands), 'uuid-2');

    assert.strictEqual(this.uploaded.test_run.result, 'passed');
  });

  it('still marks the test failed when a real assertion failure is present', async () => {
    // Envelope rollup says failed:1 — a real failure happened. The fix must
    // NOT suppress that. This is the contrast case that prevents the patch
    // from silently downgrading every failing test to passed.
    const commands = [
      {
        name: 'assert.titleContains',
        args: ['Google'],
        status: 'fail',
        result: {message: 'Expected title to contain "Google"', stack: 'AssertionError', name: 'AssertionError'}
      }
    ];

    await this.testObservability.sendTestRunEvent(
      'TestRunFinished',
      buildTest(commands, {status: 'fail', failed: 1, errors: 0}),
      'uuid-3'
    );

    assert.strictEqual(this.uploaded.test_run.result, 'failed');
    assert.strictEqual(this.uploaded.test_run.failure_type, 'AssertionError');
    // Lock the wire-shape that the original bug malformed (failure_reason:null,
    // backtrace:["",""]). The patch must propagate the real failure detail.
    assert.strictEqual(this.uploaded.test_run.failure_reason, 'Expected title to contain "Google"');
    assert.deepStrictEqual(
      this.uploaded.test_run.failure[0].backtrace,
      ['Expected title to contain "Google"', 'AssertionError']
    );
  });

  it('still marks the test failed when a non-suppressed command failed alongside a suppressed one', async () => {
    // Mixed case: one suppressed isVisible + one real failure. Envelope rollup
    // disagrees with "all passed", so we must propagate the real failure.
    const commands = [
      {
        name: 'isVisible',
        args: [{selector: '#optional', suppressNotFoundErrors: true}, null],
        status: 'fail',
        result: {message: 'Element not found'}
      },
      {
        name: 'click',
        args: ['#mandatory'],
        status: 'fail',
        result: {message: 'Element #mandatory not found', stack: 'NoSuchElementError', name: 'NoSuchElementError'}
      }
    ];

    await this.testObservability.sendTestRunEvent(
      'TestRunFinished',
      buildTest(commands, {status: 'fail', failed: 0, errors: 1}),
      'uuid-4'
    );

    assert.strictEqual(this.uploaded.test_run.result, 'failed');
    // failedCommand must skip the suppressed one and pick the real one — confirm
    // by asserting the failure_reason references the mandatory selector, not the
    // suppressed optional one.
    assert.strictEqual(this.uploaded.test_run.failure_type, 'UnhandledError');
    assert.ok(
      this.uploaded.test_run.failure_reason.includes('#mandatory'),
      `expected failure_reason to reference the real failure, got: ${this.uploaded.test_run.failure_reason}`
    );
  });

  // LTS regression: main-path Nightwatch TestRunFinished never carried
  // duration_in_ms, leaving BTCER.duration NULL on load-testing builds and
  // zeroing every duration-derived Tests-tab metric (min/avg/p50/p95/max).
  // The fix computes duration from the envelope timestamps only when
  // helper.isLoadTestingSession() is true. Non-LTS runs remain unchanged.
  it('populates duration_in_ms from timestamps on LTS runs', async () => {
    this.sandbox.stub(helper, 'isLoadTestingSession').returns(true);
    const commands = [{name: 'url', args: ['https://example.com'], status: 'pass'}];

    await this.testObservability.sendTestRunEvent('TestRunFinished', buildTest(commands), 'uuid-lts-1');

    // Fixture: startTimestamp=1700000000000, endTimestamp=1700000001000 → 1000 ms.
    assert.strictEqual(this.uploaded.test_run.duration_in_ms, 1000);
  });

  it('leaves duration_in_ms unset on non-LTS runs', async () => {
    this.sandbox.stub(helper, 'isLoadTestingSession').returns(false);
    const commands = [{name: 'url', args: ['https://example.com'], status: 'pass'}];

    await this.testObservability.sendTestRunEvent('TestRunFinished', buildTest(commands), 'uuid-lts-2');

    assert.ok(
      !('duration_in_ms' in this.uploaded.test_run),
      'expected no duration_in_ms on non-LTS runs (contract preserved)'
    );
  });

  // LTS step-level insights: the LCNC compiler wraps each recorded step in a
  // bstackStep() helper that pushes {id, text, duration, ...} to
  // global.__bstack_steps. sendTestRunEvent must attach that array to
  // testData.meta.steps at TestRunFinished (only when isLoadTestingSession()
  // is true) so the Testhub MV mv_btcer_step_metrics_v5 fans it out into the
  // btcer_step_metrics_v5 table that Step Insights aggregates on.
  it('attaches global.__bstack_steps to meta.steps on LTS runs', async () => {
    this.sandbox.stub(helper, 'isLoadTestingSession').returns(true);
    const steps = [
      {id: 'a', text: 'Open page', keyword: '', duration: 800, started_at: '2026-07-27T16:00:00.000', finished_at: '2026-07-27T16:00:00.800', result: 'passed', failure: null},
      {id: 'b', text: 'Click X',   keyword: '', duration: 120, started_at: '2026-07-27T16:00:00.800', finished_at: '2026-07-27T16:00:00.920', result: 'passed', failure: null}
    ];
    global.__bstack_steps = steps;
    const commands = [{name: 'url', args: ['https://example.com'], status: 'pass'}];

    try {
      await this.testObservability.sendTestRunEvent('TestRunFinished', buildTest(commands), 'uuid-lts-steps-1');
      assert.deepStrictEqual(this.uploaded.test_run.meta && this.uploaded.test_run.meta.steps, steps);
    } finally {
      delete global.__bstack_steps;
    }
  });

  it('omits meta.steps on non-LTS runs even when the buffer is populated', async () => {
    this.sandbox.stub(helper, 'isLoadTestingSession').returns(false);
    global.__bstack_steps = [{id: 'a', text: 'Open page', duration: 800, result: 'passed'}];
    const commands = [{name: 'url', args: ['https://example.com'], status: 'pass'}];

    try {
      await this.testObservability.sendTestRunEvent('TestRunFinished', buildTest(commands), 'uuid-lts-steps-2');
      const meta = this.uploaded.test_run.meta;
      assert.ok(!meta || !('steps' in meta), 'expected no meta.steps on non-LTS runs (contract preserved)');
    } finally {
      delete global.__bstack_steps;
    }
  });

  it('leaves meta.steps unset on LTS runs when the buffer is empty or missing', async () => {
    this.sandbox.stub(helper, 'isLoadTestingSession').returns(true);
    delete global.__bstack_steps;
    const commands = [{name: 'url', args: ['https://example.com'], status: 'pass'}];

    await this.testObservability.sendTestRunEvent('TestRunFinished', buildTest(commands), 'uuid-lts-steps-3');
    const meta = this.uploaded.test_run.meta;
    assert.ok(!meta || !('steps' in meta), 'expected no meta.steps when nothing was recorded');
  });
});
