const assert = require('assert');
const sinon = require('sinon');

const helper = require('../../../src/utils/helper');
const requestHelper = require('../../../src/utils/requestHelper');
const TestMap = require('../../../src/utils/testMap');
const TestObservability = require('../../../src/testObservability');

// The LT-only SIGTERM path. When the runner cuts a run it SIGTERMs the plugin, which finishes the
// cut test `interrupted` (LCNC: with its completed steps) from that test's own TestRunStarted
// payload, drains the queue, stops the build and exits 143 within the stop deadline.
const TEST_OBSERVABILITY_PATH = require.resolve('../../../src/testObservability');

// The fields TestHub hashes and stores per row: the interrupted finish must carry the TestRunStarted
// values verbatim, or the consumer re-hashes it into a second Tests-tab row.
const IDENTITY_FIELDS = ['uuid', 'type', 'name', 'body', 'scope', 'scopes', 'tags', 'identifier', 'file_name',
  'location', 'vc_filepath', 'started_at', 'framework', 'integrations', 'product_map'];

const buildTest = (testcase = 'lcnc script') => ({
  metadata: {
    name: 'LCNC Suite',
    tags: ['tra'],
    modulePath: `${process.cwd()}/tests/lcnc.js`,
    host: 'localhost',
    sessionId: 'session-id-stub',
    sessionCapabilities: {}
  },
  testcase,
  testCaseData: {testName: testcase, context: {__module: {[testcase]: function () {}}}},
  settings: {},
  envelope: {
    [testcase]: {
      startTimestamp: 1700000000000,
      testcase: {endTimestamp: 1700000001000, commands: [], status: 'pass', failed: 0, errors: 0}
    }
  }
});

const step = (id, text = `step ${id}`) => ({id, text, keyword: '', duration: 10, result: 'passed', failure: null});

// process.env must be restored key by key: assigning it a plain object drops its string coercion.
const saveEnv = (keys) => Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const restoreEnv = (saved) => Object.entries(saved).forEach(([key, value]) => {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
});

describe('TestObservability - LT interrupted finish', function () {
  let sandbox;
  let uploads;
  let testObservability;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    uploads = [];
    testObservability = new TestObservability();
    sandbox.stub(helper, 'getIntegrationsObject').returns({session_id: 'lts-session-1', product: 'loadTesting'});
    sandbox.stub(helper, 'isTestObservabilitySession').returns(true);
    sandbox.stub(helper, 'isAccessibilitySession').returns(false);
    sandbox.stub(helper, 'uploadEventData').callsFake(async (payload) => {
      uploads.push(payload);
    });
  });

  afterEach(function () {
    delete global.__bstack_steps;
    sandbox.restore();
  });

  const startRun = async (testcase) => {
    const test = buildTest(testcase);
    const uuid = TestMap.storeTestDetails(test);
    await testObservability.sendTestRunEvent('TestRunStarted', test, uuid);

    return {
      uuid,
      run: TestMap.getOpenRuns().find((r) => r.uuid === uuid),
      uploaded: uploads.find((u) => u.event_type === 'TestRunStarted' && u.test_run.uuid === uuid).test_run
    };
  };

  it('keeps a copy of the TestRunStarted payload on LT runs', async function () {
    sandbox.stub(helper, 'isLoadTestingSession').returns(true);
    const {run, uploaded} = await startRun('copy kept');

    assert.deepStrictEqual(run.startedPayload, uploaded);
    assert.notStrictEqual(run.startedPayload, uploaded, 'a copy, not the queued object');
  });

  it('keeps no copy on non-LT runs', async function () {
    sandbox.stub(helper, 'isLoadTestingSession').returns(false);
    const {run} = await startRun('no copy');

    assert.strictEqual(run.startedPayload, undefined);
  });

  it('copies every identity field from the TestRunStarted payload, never the synthetic shape', async function () {
    sandbox.stub(helper, 'isLoadTestingSession').returns(true);
    const {run, uploaded} = await startRun('identity');

    const interrupted = testObservability.buildInterruptedTestRun(run.startedPayload, '2023-11-14T22:13:25.000Z');

    IDENTITY_FIELDS.forEach((field) => {
      assert.ok(field in interrupted, `${field} present`);
      assert.deepStrictEqual(interrupted[field], uploaded[field], `${field} equals the TestRunStarted value`);
    });
    assert.strictEqual(uploaded.result, 'pending', 'the queued TestRunStarted is not mutated');
    assert.ok(!('finished_at' in uploaded));
  });

  it('sends the exact lowercase wire result interrupted, with no reason string', async function () {
    sandbox.stub(helper, 'isLoadTestingSession').returns(true);
    const {run} = await startRun('wire result');

    const wire = JSON.parse(JSON.stringify(testObservability.buildInterruptedTestRun(run.startedPayload, new Date().toISOString())));

    assert.strictEqual(wire.result, 'interrupted');
    ['failure', 'failure_reason', 'failure_type'].forEach((field) => assert.ok(!(field in wire), `no ${field}`));
  });

  it('sets duration_in_ms to the time from the TestRunStarted started_at to the cut', async function () {
    sandbox.stub(helper, 'isLoadTestingSession').returns(true);
    const {run} = await startRun('duration');

    const interrupted = testObservability.buildInterruptedTestRun(run.startedPayload, '2023-11-14T22:13:25.000Z');

    assert.strictEqual(run.startedPayload.started_at, '2023-11-14T22:13:20.000Z');
    assert.strictEqual(interrupted.finished_at, '2023-11-14T22:13:25.000Z');
    assert.strictEqual(interrupted.duration_in_ms, 5000);
  });

  it('attaches a snapshot of the completed LCNC steps', async function () {
    sandbox.stub(helper, 'isLoadTestingSession').returns(true);
    const {run} = await startRun('steps');
    global.__bstack_steps = [step('a'), step('b')];

    const interrupted = testObservability.buildInterruptedTestRun(run.startedPayload, new Date().toISOString());
    global.__bstack_steps.push(step('c')); // a step the test completes after the cut

    assert.deepStrictEqual(interrupted.meta, {steps: [step('a'), step('b')]});
  });

  it('attaches no meta when the step buffer is empty, missing or not an array', async function () {
    sandbox.stub(helper, 'isLoadTestingSession').returns(true);
    const {run} = await startRun('no steps');

    [[], undefined, 'not-an-array'].forEach((buffer) => {
      global.__bstack_steps = buffer;
      const interrupted = testObservability.buildInterruptedTestRun(run.startedPayload, new Date().toISOString());
      assert.ok(!('meta' in interrupted), `no meta for ${JSON.stringify(buffer)}`);
    });
  });

  it('keeps the longest prefix of steps whose meta fits under the TestHub limit', async function () {
    sandbox.stub(helper, 'isLoadTestingSession').returns(true);
    const {run} = await startRun('oversized');
    const steps = Array.from({length: 200}, (_, i) => step(`s${i}`, 'x'.repeat(1000)));
    global.__bstack_steps = steps;

    const {meta} = testObservability.buildInterruptedTestRun(run.startedPayload, new Date().toISOString());

    assert.ok(JSON.stringify(meta).length <= 131072, 'TestHub keeps a meta of at most 131072 chars');
    assert.ok(meta.steps.length > 0 && meta.steps.length < steps.length, 'truncated, not dropped');
    assert.deepStrictEqual(meta.steps, steps.slice(0, meta.steps.length), 'the earliest steps');
    // 4096 = the headroom kept below 131072 (LTS_META_MAX_CHARS in testObservability.js).
    assert.ok(JSON.stringify({steps: steps.slice(0, meta.steps.length + 1)}).length > 131072 - 4096,
      'one more step would not fit');
  });
});

describe('TestObservability - LT interrupted POST and bounded build stop', function () {
  let sandbox;
  let makeRequestStub;
  let originalModule;
  let FreshTestObservability;
  let savedEnv;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    savedEnv = saveEnv(['BROWSERSTACK_TESTHUB_JWT', 'BROWSERSTACK_TESTHUB_UUID', 'BS_TESTOPS_BUILD_COMPLETED']);
    process.env.BROWSERSTACK_TESTHUB_JWT = 'jwt-test';
    process.env.BROWSERSTACK_TESTHUB_UUID = 'build-1';
    process.env.BS_TESTOPS_BUILD_COMPLETED = 'true';
    makeRequestStub = sandbox.stub(requestHelper, 'makeRequest').resolves({data: {}});
    // testObservability destructures makeRequest at load time: load a fresh copy over the stub.
    originalModule = require.cache[TEST_OBSERVABILITY_PATH];
    delete require.cache[TEST_OBSERVABILITY_PATH];
    FreshTestObservability = require(TEST_OBSERVABILITY_PATH);
  });

  afterEach(function () {
    require.cache[TEST_OBSERVABILITY_PATH] = originalModule;
    restoreEnv(savedEnv);
    sandbox.restore();
  });

  it('posts the interrupted finishes in one batch request with the timeout', async function () {
    const runs = [{uuid: 'a', result: 'interrupted'}, {uuid: 'b', result: 'interrupted'}];

    await new FreshTestObservability().sendInterruptedTestRuns(runs, 2000);

    sinon.assert.calledOnce(makeRequestStub);
    const [method, url, body, config] = makeRequestStub.firstCall.args;
    assert.strictEqual(method, 'POST');
    assert.strictEqual(url, 'api/v1/batch');
    assert.deepStrictEqual(body, runs.map((test_run) => ({event_type: 'TestRunFinished', test_run})));
    assert.strictEqual(config.headers.Authorization, 'Bearer jwt-test');
    assert.strictEqual(config.timeout, 2000);
  });

  it('sends nothing when there is no interrupted finish', async function () {
    await new FreshTestObservability().sendInterruptedTestRuns([], 2000);

    sinon.assert.notCalled(makeRequestStub);
  });

  it('swallows a failed interrupted POST so the build stop still runs', async function () {
    makeRequestStub.rejects(new Error('503'));

    await new FreshTestObservability().sendInterruptedTestRuns([{uuid: 'a'}], 2000);
  });

  it('passes the timeout to the drain and the build-stop PUT', async function () {
    sandbox.stub(helper, 'uploadPending').resolves();
    const shutdownStub = sandbox.stub(helper, 'shutDownRequestHandler').resolves();

    await new FreshTestObservability().stopBuildUpstream(2000);

    sinon.assert.calledOnceWithExactly(shutdownStub, 2000);
    const [method, url, , config] = makeRequestStub.firstCall.args;
    assert.strictEqual(method, 'PUT');
    assert.strictEqual(url, 'api/v1/builds/build-1/stop');
    assert.strictEqual(config.timeout, 2000);
  });

  it('stops the build exactly as today when no timeout is given', async function () {
    sandbox.stub(helper, 'uploadPending').resolves();
    const shutdownStub = sandbox.stub(helper, 'shutDownRequestHandler').resolves();

    await new FreshTestObservability().stopBuildUpstream();

    assert.strictEqual(shutdownStub.firstCall.args[0], undefined);
    assert.ok(!('timeout' in makeRequestStub.firstCall.args[3]), 'PUT config unchanged for the non-LT path');
  });
});
