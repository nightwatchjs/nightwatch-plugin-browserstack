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
    assert.strictEqual(config.totalTimeout, 2000);
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
    assert.strictEqual(config.totalTimeout, 2000);
  });

  it('stops the build exactly as today when no timeout is given', async function () {
    sandbox.stub(helper, 'uploadPending').resolves();
    const shutdownStub = sandbox.stub(helper, 'shutDownRequestHandler').resolves();

    await new FreshTestObservability().stopBuildUpstream();

    assert.strictEqual(shutdownStub.firstCall.args[0], undefined);
    assert.ok(!('timeout' in makeRequestStub.firstCall.args[3]), 'PUT config unchanged for the non-LT path');
    assert.ok(!('totalTimeout' in makeRequestStub.firstCall.args[3]), 'no total timeout on the non-LT PUT');
  });
});

describe('helper.shouldInstallLtsStopPath - the LT-path gate', function () {
  const KEYS = ['BROWSERSTACK_LTS_SESSION_ID', 'BROWSERSTACK_LTS', 'BROWSERSTACK_TESTHUB_UUID', 'BROWSERSTACK_TESTHUB_JWT',
    'BROWSERSTACK_LTS_SDK_PID_FILE'];
  let savedEnv;

  beforeEach(function () {
    savedEnv = saveEnv(KEYS);
    KEYS.forEach((key) => delete process.env[key]);
    process.env.BROWSERSTACK_LTS_SESSION_ID = 'lts-session-1';
    process.env.BROWSERSTACK_TESTHUB_UUID = 'build-1';
    process.env.BROWSERSTACK_TESTHUB_JWT = 'jwt-test';
    process.env.BROWSERSTACK_LTS_SDK_PID_FILE = '/opt/lts/sdk-pids/nw-1.pid';
  });

  afterEach(function () {
    restoreEnv(savedEnv);
  });

  it('holds for an LT session with a TestHub build and the runner PID-file env, without Local', function () {
    assert.strictEqual(helper.shouldInstallLtsStopPath(false), true);
    assert.strictEqual(helper.shouldInstallLtsStopPath(undefined), true);
  });

  ['BROWSERSTACK_LTS_SESSION_ID', 'BROWSERSTACK_TESTHUB_UUID', 'BROWSERSTACK_TESTHUB_JWT', 'BROWSERSTACK_LTS_SDK_PID_FILE'].forEach((key) => {
    it(`does not hold without ${key}`, function () {
      delete process.env[key];
      assert.strictEqual(helper.shouldInstallLtsStopPath(false), false);
    });
  });

  it('does not hold while the BrowserStack Local tunnel runs', function () {
    assert.strictEqual(helper.shouldInstallLtsStopPath(true), false);
  });
});

describe('globals - LT SIGTERM path', function () {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const LocalTunnel = require('../../../src/local-tunnel');
  const AccessibilityAutomation = require('../../../src/accessibilityAutomation');
  const OrchestrationUtils = require('../../../src/testorchestration/orchestrationUtils');
  const GLOBALS_PATH = require.resolve('../../../nightwatch/globals.js');
  // Placeholder budgets; final values are set by measurement. D_MS is the stop deadline and
  // T_REQ_MS the per-request timeout.
  const D_MS = 8000;
  const T_REQ_MS = 2000;
  const ENV_KEYS = ['BROWSERSTACK_LTS_SESSION_ID', 'BROWSERSTACK_TESTHUB_UUID', 'BROWSERSTACK_TESTHUB_JWT',
    'BROWSERSTACK_LTS_SDK_PID_FILE', 'BS_TESTOPS_BUILD_COMPLETED', 'BROWSERSTACK_APP_AUTOMATE', 'BROWSERSTACK_LOCAL_ENABLED',
    'BROWSERSTACK_LOCAL_IDENTIFIER', 'TEST_RUN_UUID', 'VALID_ALLY_PLATFORM'];
  const LISTENED = [[process, 'SIGTERM'], [process, 'exit'], [process.stdout, 'error'], [process.stderr, 'error']];

  let sandbox;
  let clock;
  let savedEnv;
  let savedExitCode;
  let listenerSnapshot;
  let tmpDir;
  let pidFile;
  let uploads;
  let exitStub;
  let drainStub;
  let interruptedStub;
  let stopBuildStub;
  let globals;
  let handlers;

  const flush = async (until = () => false) => {
    for (let i = 0; i < 50 && !until(); i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    return {promise, resolve, reject};
  };
  const added = (index) => {
    const [emitter, event] = LISTENED[index];

    return emitter.listeners(event).filter((listener) => !listenerSnapshot[index].includes(listener));
  };
  const loadGlobals = () => {
    delete require.cache[GLOBALS_PATH];
    globals = require(GLOBALS_PATH);
    handlers = {};
    globals.registerEventHandlers({on: (name, fn) => {
      handlers[name] = fn;
    }});
  };
  const startTest = async (testcase) => {
    await handlers['TestRunStarted'](buildTest(testcase));

    return process.env.TEST_RUN_UUID;
  };
  const sigterm = async () => {
    process.emit('SIGTERM', 'SIGTERM');
    await flush(() => exitStub.called);
  };
  const beforeSettings = () => ({
    test_runner: {type: 'default', options: {}},
    '@nightwatch/browserstack': {},
    desiredCapabilities: {},
    globals: {}
  });

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    savedEnv = saveEnv(ENV_KEYS);
    savedExitCode = process.exitCode;
    listenerSnapshot = LISTENED.map(([emitter, event]) => emitter.listeners(event));
    // Runs left open by other suites would otherwise count as this process's open runs.
    TestMap.getOpenRuns().forEach((run) => TestMap.markTestFinished(run.uuid));

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lts-stop-path-'));
    pidFile = path.join(tmpDir, 'nw-1.pid');
    process.env.BROWSERSTACK_LTS_SESSION_ID = 'lts-session-1';
    process.env.BROWSERSTACK_TESTHUB_UUID = 'build-1';
    process.env.BROWSERSTACK_TESTHUB_JWT = 'jwt-test';
    process.env.BROWSERSTACK_LTS_SDK_PID_FILE = pidFile;
    process.env.BS_TESTOPS_BUILD_COMPLETED = 'true';
    delete process.env.TEST_RUN_UUID;
    delete process.env.BROWSERSTACK_APP_AUTOMATE;

    clock = sandbox.useFakeTimers({now: 1700000005000, toFake: ['setTimeout', 'clearTimeout', 'Date']});
    exitStub = sandbox.stub(process, 'exit');
    uploads = [];
    sandbox.stub(helper, 'uploadEventData').callsFake(async (payload) => {
      uploads.push(payload);
    });
    drainStub = sandbox.stub(helper, 'shutDownRequestHandler').resolves();
    interruptedStub = sandbox.stub(TestObservability.prototype, 'sendInterruptedTestRuns').resolves();
    stopBuildStub = sandbox.stub(TestObservability.prototype, 'stopBuildUpstream').resolves();
    sandbox.stub(AccessibilityAutomation.prototype, 'validateA11yCaps').returns(false);
    sandbox.stub(AccessibilityAutomation.prototype, 'validateAppA11yCaps').returns(false);
    sandbox.stub(AccessibilityAutomation.prototype, 'beforeEachExecution').resolves();
    sandbox.stub(AccessibilityAutomation.prototype, 'afterEachExecution').resolves();
    global.browser = {sessionId: 'session-1', capabilities: {browserName: 'chrome'}, execute: sandbox.stub().resolves()};
    loadGlobals();
  });

  afterEach(function () {
    LISTENED.forEach(([emitter, event], index) => {
      added(index).forEach((listener) => emitter.removeListener(event, listener));
    });
    sandbox.restore();
    process.exitCode = savedExitCode;
    restoreEnv(savedEnv);
    delete global.browser;
    delete global.__bstack_steps;
    fs.rmSync(tmpDir, {recursive: true, force: true});
  });

  describe('install', function () {
    const stubBefore = (launch = true) => {
      sandbox.stub(TestObservability.prototype, 'configure');
      sandbox.stub(TestObservability.prototype, 'launchTestSession').callsFake(async () => {
        if (launch) {
          process.env.BROWSERSTACK_TESTHUB_UUID = 'build-1';
          process.env.BROWSERSTACK_TESTHUB_JWT = 'jwt-test';
        }
      });
      sandbox.stub(AccessibilityAutomation.prototype, 'configure');
      sandbox.stub(helper, 'isTestObservabilitySession').returns(true);
      sandbox.stub(helper, 'isTestHubBuild').returns(true);
      sandbox.stub(helper, 'isAccessibilitySession').returns(false);
      sandbox.stub(OrchestrationUtils, 'getInstance').returns({testOrderingEnabled: () => false});
    };

    it('writes the PID file and installs one SIGTERM handler after a successful build start', async function () {
      stubBefore();
      delete process.env.BROWSERSTACK_TESTHUB_UUID;
      delete process.env.BROWSERSTACK_TESTHUB_JWT;

      await globals.before(beforeSettings(), {});

      assert.strictEqual(fs.readFileSync(pidFile, 'utf8'), String(process.pid));
      // POSIX file modes do not apply on Windows.
      if (process.platform !== 'win32') {
        assert.strictEqual(fs.statSync(pidFile).mode & 0o777, 0o644);
      }
      assert.strictEqual(added(0).length, 1, 'one SIGTERM handler');
      assert.ok(!fs.existsSync(`${pidFile}.tmp`), 'no temp file left behind');
    });

    it('installs nothing when the build start failed', async function () {
      stubBefore(false);
      delete process.env.BROWSERSTACK_TESTHUB_UUID;
      delete process.env.BROWSERSTACK_TESTHUB_JWT;

      await globals.before(beforeSettings(), {});

      assert.ok(!fs.existsSync(pidFile), 'no PID file');
      assert.strictEqual(added(0).length, 0, 'no SIGTERM handler');
    });

    it('installs nothing without the runner PID-file env', async function () {
      stubBefore();
      delete process.env.BROWSERSTACK_LTS_SDK_PID_FILE;

      await globals.before(beforeSettings(), {});

      assert.strictEqual(fs.readdirSync(tmpDir).length, 0, 'no PID file');
      assert.strictEqual(added(0).length, 0, 'no SIGTERM handler');
    });

    it('installs nothing while the BrowserStack Local tunnel runs', async function () {
      stubBefore();
      sandbox.stub(LocalTunnel.prototype, 'start').callsFake(async function () {
        this._localTunnel = {isRunning: () => true};
      });

      await globals.before(beforeSettings(), {});

      assert.ok(!fs.existsSync(pidFile), 'no PID file');
      assert.strictEqual(added(0).length, 0, 'no SIGTERM handler');
    });

    it('installs nothing, and does not throw, when the PID file cannot be written', async function () {
      stubBefore();
      process.env.BROWSERSTACK_LTS_SDK_PID_FILE = path.join(tmpDir, 'missing-dir', 'nw-1.pid');

      await globals.before(beforeSettings(), {});

      assert.strictEqual(added(0).length, 0, 'no SIGTERM handler');
    });

    it('writes the PID file 0644 even under umask 077', function () {
      const previousUmask = process.umask(0o077);
      try {
        globals.installLtsStopPath();
      } finally {
        process.umask(previousUmask);
      }

      // POSIX file modes do not apply on Windows.
      if (process.platform !== 'win32') {
        assert.strictEqual(fs.statSync(pidFile).mode & 0o777, 0o644);
      }
    });

    it('removes the PID file on exit', function () {
      globals.installLtsStopPath();
      assert.ok(fs.existsSync(pidFile));

      added(1).forEach((listener) => listener(143));

      assert.ok(!fs.existsSync(pidFile));
    });

    it('ignores EPIPE on stdout and stderr, and rethrows other stream errors', function () {
      globals.installLtsStopPath();
      const epipe = Object.assign(new Error('write EPIPE'), {code: 'EPIPE'});
      const other = Object.assign(new Error('write EIO'), {code: 'EIO'});

      added(2).forEach((listener) => listener(epipe));
      added(3).forEach((listener) => listener(epipe));
      assert.strictEqual(added(2).length, 1);
      assert.throws(() => added(2)[0](other), /EIO/);
    });
  });

  describe('on SIGTERM', function () {
    beforeEach(function () {
      globals.installLtsStopPath();
    });

    it('finishes the open run interrupted, then drains, sends it, stops the build, and exits 143', async function () {
      const uuid = await startTest('cut test');
      global.__bstack_steps = [step('a'), step('b')];

      await sigterm();

      sinon.assert.calledOnceWithExactly(drainStub, T_REQ_MS);
      sinon.assert.calledOnce(interruptedStub);
      const [runs, timeout] = interruptedStub.firstCall.args;
      assert.strictEqual(timeout, T_REQ_MS);
      assert.deepStrictEqual(runs.map((run) => [run.uuid, run.result]), [[uuid, 'interrupted']]);
      assert.deepStrictEqual(runs[0].meta, {steps: [step('a'), step('b')]});
      sinon.assert.calledOnceWithExactly(stopBuildStub, T_REQ_MS);
      sinon.assert.callOrder(drainStub, interruptedStub, stopBuildStub);
      sinon.assert.calledOnceWithExactly(exitStub, 143);
      assert.ok(T_REQ_MS < D_MS);
      assert.strictEqual(TestMap.hasTestFinished(uuid), true);
    });

    it('waits for in-flight events before the drain', async function () {
      const inFlight = deferred();
      helper.uploadEventData.callsFake(() => inFlight.promise);
      await startTest('in flight');

      process.emit('SIGTERM', 'SIGTERM');
      await flush();
      sinon.assert.notCalled(drainStub);

      inFlight.resolve();
      await flush(() => exitStub.called);
      sinon.assert.calledOnce(drainStub);
    });

    it('a rejected in-flight event does not stop the flush', async function () {
      const inFlight = deferred();
      helper.uploadEventData.callsFake(() => inFlight.promise);
      await startTest('in flight rejects');

      process.emit('SIGTERM', 'SIGTERM');
      await flush();
      inFlight.reject(new Error('upload failed'));
      await flush(() => exitStub.called);

      sinon.assert.callOrder(drainStub, interruptedStub, stopBuildStub);
      sinon.assert.calledOnceWithExactly(exitStub, 143);
    });

    it('a later teardown sweep sends no failed finish for an interrupted run', async function () {
      const uuid = await startTest('swept later');
      await sigterm();

      await globals.performTeardownSweep();

      assert.strictEqual(uploads.filter((u) => u.event_type === 'TestRunFinished' && u.test_run.uuid === uuid).length, 0);
    });

    it('with no open run, sends no interrupted finish but still drains and stops the build', async function () {
      await sigterm();

      assert.deepStrictEqual(interruptedStub.firstCall.args[0], []);
      sinon.assert.callOrder(drainStub, interruptedStub, stopBuildStub);
      sinon.assert.calledOnceWithExactly(exitStub, 143);
    });

    it('skips an open run whose TestRunStarted payload was never built, and marks it finished', async function () {
      const uuid = TestMap.storeTestDetails(buildTest('never sent'));

      await sigterm();

      assert.deepStrictEqual(interruptedStub.firstCall.args[0], []);
      assert.strictEqual(TestMap.hasTestFinished(uuid), true);
    });

    it('a step buffer that cannot be serialised does not stop the flush', async function () {
      await startTest('circular steps');
      const circular = step('a');
      circular.self = circular;
      global.__bstack_steps = [circular];

      await sigterm();

      sinon.assert.callOrder(drainStub, interruptedStub, stopBuildStub);
      sinon.assert.calledOnceWithExactly(exitStub, 143);
    });

    it('ignores a TestRunStarted after the signal', async function () {
      await sigterm();
      const startsBefore = uploads.filter((u) => u.event_type === 'TestRunStarted').length;

      await handlers['TestRunStarted'](buildTest('after the signal'));

      assert.strictEqual(uploads.filter((u) => u.event_type === 'TestRunStarted').length, startsBefore);
      assert.strictEqual(TestMap.getOpenRuns().length, 0);
    });

    it('ignores a TestRunFinished that starts after the signal, without touching the browser', async function () {
      await sigterm();
      delete process.env.TEST_RUN_UUID;

      await handlers['TestRunFinished'](buildTest('never started'));

      sinon.assert.notCalled(global.browser.execute);
      assert.strictEqual(uploads.filter((u) => u.event_type === 'TestRunFinished').length, 0);
    });

    it('suppresses a TestRunFinished already past its entry check when the signal lands', async function () {
      const uuid = await startTest('finish in flight');
      const pastEntryCheck = deferred();
      AccessibilityAutomation.prototype.afterEachExecution.returns(pastEntryCheck.promise);
      const finishing = handlers['TestRunFinished'](buildTest('finish in flight'));
      await flush();

      await sigterm();
      pastEntryCheck.resolve();
      await finishing;

      assert.strictEqual(uploads.filter((u) => u.event_type === 'TestRunFinished' && u.test_run.uuid === uuid).length, 0,
        'no real finish follows the interrupted one');
      assert.deepStrictEqual(interruptedStub.firstCall.args[0].map((run) => run.uuid), [uuid]);
    });

    it('never calls the browser', async function () {
      await startTest('no browser');
      global.browser.execute.resetHistory();

      await sigterm();

      sinon.assert.notCalled(global.browser.execute);
    });

    it('ignores a second SIGTERM', async function () {
      await sigterm();
      await sigterm();

      sinon.assert.calledOnce(drainStub);
      sinon.assert.calledOnce(stopBuildStub);
    });

    it('exits 143 at the deadline when the drain hangs, dropping the interrupted POST and the build stop', async function () {
      await startTest('drain hangs');
      drainStub.returns(new Promise(() => {}));

      process.emit('SIGTERM', 'SIGTERM');
      await flush();
      clock.tick(D_MS - 1);
      sinon.assert.notCalled(exitStub);
      clock.tick(1);

      sinon.assert.calledOnceWithExactly(exitStub, 143);
      sinon.assert.notCalled(interruptedStub);
      sinon.assert.notCalled(stopBuildStub);
    });
  });

  describe('teardown ownership with after()', function () {
    beforeEach(function () {
      globals.installLtsStopPath();
      sandbox.stub(helper, 'isTestObservabilitySession').returns(false);
      sandbox.stub(helper, 'isTestHubBuild').returns(true);
    });

    it('a SIGTERM during after() only enforces exit 143 at the deadline', async function () {
      const buildStop = deferred();
      stopBuildStub.returns(buildStop.promise);
      const tearingDown = globals.after();
      await flush(() => stopBuildStub.called);

      process.emit('SIGTERM', 'SIGTERM');
      await flush();

      sinon.assert.notCalled(drainStub);
      sinon.assert.notCalled(interruptedStub);
      sinon.assert.calledOnce(stopBuildStub);
      clock.tick(D_MS);
      sinon.assert.calledOnceWithExactly(exitStub, 143);

      buildStop.resolve();
      await tearingDown;
      assert.strictEqual(process.exitCode, 143, 'the process.exit() of after() reports the signal too');
    });

    it('after() returns at once when the SIGTERM handler owns teardown', async function () {
      drainStub.returns(new Promise(() => {}));
      const tunnelStop = sandbox.spy(LocalTunnel.prototype, 'stop');
      process.emit('SIGTERM', 'SIGTERM');
      await flush();

      await globals.after();

      sinon.assert.notCalled(tunnelStop);
      sinon.assert.notCalled(stopBuildStub);
      sinon.assert.notCalled(exitStub);
    });
  });
});
