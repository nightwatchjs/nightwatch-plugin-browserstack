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
    // failedCommand must skip the suppressed one and pick the real one.
    assert.strictEqual(this.uploaded.test_run.failure_type, 'UnhandledError');
  });
});
