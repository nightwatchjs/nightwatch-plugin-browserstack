const assert = require('assert');
const sinon = require('sinon');

const helper = require('../../../src/utils/helper');
const TestMap = require('../../../src/utils/testMap');
const TestObservability = require('../../../src/testObservability');

describe('TestObservability - getCucumberHookType never returns undefined', function () {
  let testObservability;

  beforeEach(function () {
    testObservability = new TestObservability();
  });

  it('classifies a per-scenario hook before any step as BEFORE_EACH', function () {
    const testSteps = [{id: 'h1', hookId: 'hook-1'}, {id: 's1', pickleStepId: 'ps1'}];
    assert.strictEqual(testObservability.getCucumberHookType(testSteps, {id: 'h1'}), 'BEFORE_EACH');
  });

  it('classifies a per-scenario hook after a step as AFTER_EACH', function () {
    const testSteps = [{id: 's1', pickleStepId: 'ps1'}, {id: 'h1', hookId: 'hook-1'}];
    assert.strictEqual(testObservability.getCucumberHookType(testSteps, {id: 'h1'}), 'AFTER_EACH');
  });

  it('classifies a hook absent from the scenario steps as a suite-level hook', function () {
    assert.strictEqual(testObservability.getCucumberHookType([], {id: 'missing'}), 'BEFORE_ALL');
    assert.strictEqual(testObservability.getCucumberHookType([{id: 's1', pickleStepId: 'ps1'}], {id: 'missing'}), 'AFTER_ALL');
  });

  it('never returns undefined across malformed inputs', function () {
    const cases = [
      testObservability.getCucumberHookType([], {}),
      testObservability.getCucumberHookType(undefined, {id: 'x'}),
      testObservability.getCucumberHookType([{id: 's1', pickleStepId: 'ps1'}], {id: 'h1'})
    ];
    cases.forEach((hookType) => {
      assert.notStrictEqual(hookType, undefined, 'hook_type must never be undefined');
      assert.ok(['BEFORE_EACH', 'AFTER_EACH', 'BEFORE_ALL', 'AFTER_ALL'].includes(hookType));
    });
  });
});

describe('TestObservability - sweepOpenHooks', function () {
  let sandbox;
  let uploads;
  let testObservability;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    uploads = [];
    testObservability = new TestObservability();
    sandbox.stub(helper, 'uploadEventData').callsFake(async (payload) => {
      uploads.push(payload);
    });
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('finishes a hook that started but never finished, idempotently', async function () {
    const args = {
      envelope: {testCaseStartedId: 'sweep-tcs-1'},
      report: {hooks: [{id: 'hook-A', name: 'Before', sourceReference: {uri: 'features/support/hooks.js'}}]}
    };
    const testSteps = [{id: 'step-A', hookId: 'hook-A'}];

    await testObservability.sendHook(args, 'HookRunStarted', testSteps, 'step-A', {feature: {name: 'Feature A'}});
    await testObservability.sweepOpenHooks();

    const finished = uploads.filter((u) => u.event_type === 'HookRunFinished' && u.hook_run && u.hook_run.uuid === 'step-A');
    assert.strictEqual(finished.length, 1, 'open hook is finished once');
    assert.strictEqual(finished[0].hook_run.result, 'failed', 'synthetic hook finish is terminal (failed)');

    await testObservability.sweepOpenHooks();
    const finishedAgain = uploads.filter((u) => u.event_type === 'HookRunFinished' && u.hook_run && u.hook_run.uuid === 'step-A');
    assert.strictEqual(finishedAgain.length, 1, 'second sweep does not double-finish the hook');
  });
});

describe('TestMap.getOpenRuns and synthetic native finish', function () {
  let sandbox;
  let uploads;
  let testObservability;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    uploads = [];
    testObservability = new TestObservability();
    sandbox.stub(helper, 'uploadEventData').callsFake(async (payload) => {
      uploads.push(payload);
    });
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('reports an unfinished run, synthesises a failed finish, and clears it after markTestFinished', async function () {
    const uuid = TestMap.storeTestDetails({testcase: 'native test', metadata: {name: 'Native Module'}});

    const openBefore = TestMap.getOpenRuns().filter((r) => r.uuid === uuid);
    assert.strictEqual(openBefore.length, 1, 'stored run is reported as open');

    await testObservability.sendSyntheticTestRunFinished(uuid, openBefore[0]);
    const finished = uploads.filter((u) => u.event_type === 'TestRunFinished' && u.test_run && u.test_run.uuid === uuid);
    assert.strictEqual(finished.length, 1, 'a terminal finish is emitted for the open run');
    assert.strictEqual(finished[0].test_run.result, 'failed', 'synthetic native finish is terminal (failed)');

    TestMap.markTestFinished(uuid);
    const openAfter = TestMap.getOpenRuns().filter((r) => r.uuid === uuid);
    assert.strictEqual(openAfter.length, 0, 'finished run is no longer reported as open');
  });
});
