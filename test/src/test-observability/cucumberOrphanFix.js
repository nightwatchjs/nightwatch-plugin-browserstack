const assert = require('assert');
const sinon = require('sinon');

const helper = require('../../../src/utils/helper');
const TestObservability = require('../../../src/testObservability');

// Coverage for the cucumber orphan/timeout fix.
//
// The cucumber _tests map used to be keyed by the non-unique testCaseId. On
// reruns/retries/parallel interleaving, a second TestCaseStarted overwrote the
// first attempt's entry, so the first TestCaseFinished deleted it and the later
// attempt found no entry -> no TestRunFinished was emitted, leaving the run open
// to be reaped as a timeout. The map is now keyed by the unique testCaseStartedId,
// and a teardown sweep finishes anything still open.
const GLOBALS_PATH = require.resolve('../../../nightwatch/globals.js');

function loadGlobals() {
  delete require.cache[GLOBALS_PATH];

  return require('../../../nightwatch/globals.js');
}

function makeBroadcaster() {
  const handlers = {};

  return {
    on(name, fn) {
      handlers[name] = fn;
    },
    handlers
  };
}

function buildReport() {
  return {
    testCaseStarted: {
      'tcs-1': {testCaseId: 'tc-1'},
      'tcs-2': {testCaseId: 'tc-1'}
    },
    testCases: [{id: 'tc-1', pickleId: 'p-1', testSteps: []}],
    pickle: [{id: 'p-1', name: 'Scenario A', uri: 'features/a.feature', tags: [], steps: []}],
    gherkinDocument: [{uri: 'features/a.feature', feature: {name: 'Feature A', description: ''}}]
  };
}

describe('globals - cucumber rerun correlation and teardown sweep', function () {
  let sandbox;
  let cucumberCalls;
  let uploads;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    cucumberCalls = [];
    uploads = [];

    sandbox.stub(helper, 'isTestObservabilitySession').returns(true);
    sandbox.stub(helper, 'isTestHubBuild').returns(true);
    sandbox.stub(TestObservability.prototype, 'sendTestRunEventForCucumber')
      .callsFake(async (reportData, gherkinDocument, pickleData, eventType, testMetaData) => {
        cucumberCalls.push({eventType, uuid: testMetaData && testMetaData.uuid});
      });
    sandbox.stub(helper, 'uploadEventData').callsFake(async (payload) => {
      uploads.push(payload);
    });
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('emits a TestRunFinished for two attempts sharing a testCaseId but differing by testCaseStartedId', async function () {
    const globals = loadGlobals();
    const broadcaster = makeBroadcaster();
    globals.registerEventHandlers(broadcaster);
    const report = buildReport();

    await broadcaster.handlers['TestCaseStarted']({envelope: {id: 'tcs-1', testCaseId: 'tc-1'}, report});
    await broadcaster.handlers['TestCaseStarted']({envelope: {id: 'tcs-2', testCaseId: 'tc-1'}, report});
    await broadcaster.handlers['TestCaseFinished']({envelope: {testCaseStartedId: 'tcs-1'}, report});
    await broadcaster.handlers['TestCaseFinished']({envelope: {testCaseStartedId: 'tcs-2'}, report});

    const started = cucumberCalls.filter((c) => c.eventType === 'TestRunStarted');
    const finished = cucumberCalls.filter((c) => c.eventType === 'TestRunFinished');

    assert.strictEqual(started.length, 2, 'both attempts should start');
    assert.strictEqual(finished.length, 2, 'both attempts should finish (no orphan)');

    const startUuids = started.map((c) => c.uuid).sort();
    const finishUuids = finished.map((c) => c.uuid).sort();
    assert.notStrictEqual(startUuids[0], startUuids[1], 'attempts have distinct uuids');
    assert.deepStrictEqual(finishUuids, startUuids, 'both started uuids are finished');
  });

  it('sweep emits a terminal failed TestRunFinished for a scenario left open in _tests, idempotently', async function () {
    const globals = loadGlobals();
    const broadcaster = makeBroadcaster();
    globals.registerEventHandlers(broadcaster);
    const report = buildReport();

    await broadcaster.handlers['TestCaseStarted']({envelope: {id: 'tcs-1', testCaseId: 'tc-1'}, report});
    const startCall = cucumberCalls.find((c) => c.eventType === 'TestRunStarted');
    const openUuid = startCall.uuid;

    await globals.performTeardownSweep();

    const swept = uploads.filter((u) => u.event_type === 'TestRunFinished' && u.test_run && u.test_run.uuid === openUuid);
    assert.strictEqual(swept.length, 1, 'open scenario is finished exactly once by the sweep');
    assert.strictEqual(swept[0].test_run.result, 'failed', 'synthetic finish is terminal (failed)');

    await globals.performTeardownSweep();
    const sweptAgain = uploads.filter((u) => u.event_type === 'TestRunFinished' && u.test_run && u.test_run.uuid === openUuid);
    assert.strictEqual(sweptAgain.length, 1, 'second sweep does not double-finish the scenario');
  });
});
