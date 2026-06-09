const {v4: uuidv4} = require('uuid');

const sharedTestMap = new Map();
let sharedCurrentTest = null;
const activeTestRuns = new Map(); 

class TestMap {
  
  static storeTestDetails(test) {
    const testIdentifier = this.generateTestIdentifier(test);
    const uuid = this.generateUUID();

    if (!sharedTestMap.has(testIdentifier)) {
      sharedTestMap.set(testIdentifier, {
        baseUuid: uuid, // Store the first UUID as base
        retries: [],
        currentUuid: uuid,
        test,
        createdAt: new Date().toISOString()
      });
    } else {
      // This is a retry - add new UUID to retries array
      const testData = sharedTestMap.get(testIdentifier);
      testData.retries.push({
        uuid,
        startedAt: new Date().toISOString()
      });
      testData.currentUuid = uuid; // Update to latest UUID
      sharedTestMap.set(testIdentifier, testData);
    }

    // Track this as an active test run
    activeTestRuns.set(uuid, {
      identifier: testIdentifier,
      startedAt: new Date().toISOString(),
      hasFinished: false
    });

    sharedCurrentTest = testIdentifier;

    return uuid;
  }

  // Snapshot the live BrowserStack session id and capabilities for a uuid at
  // TestRunStarted time. The reporter's metadata.sessionId only reflects the
  // first session of the suite, and `browser.sessionId` may already be null
  // by the time TestRunFinished fires (afterEach calling browser.end() can
  // race the async event handler). Storing the snapshot lets TestRunFinished
  // reach back to the correct session id even after the session has been
  // ended.
  static setSessionSnapshot(uuid, sessionId, capabilities) {
    if (!uuid || !activeTestRuns.has(uuid)) {return}
    const run = activeTestRuns.get(uuid);
    run.sessionId = sessionId;
    run.sessionCapabilities = capabilities;
    activeTestRuns.set(uuid, run);
  }

  static getSessionSnapshot(uuid) {
    if (!uuid || !activeTestRuns.has(uuid)) {return null}
    const run = activeTestRuns.get(uuid);
    if (!run.sessionId) {return null}

    return {sessionId: run.sessionId, sessionCapabilities: run.sessionCapabilities};
  }

  static getUUID(test = null) {
    if (test) {
      const testIdentifier = typeof test === 'string' ? test : this.generateTestIdentifier(test);
      const testData = sharedTestMap.get(testIdentifier);
      if (testData) {
        return testData.currentUuid;
      }
    }
    
    // Fall back to the most recently started run that has not finished yet, so a
    // finish event whose identifier cannot be resolved still lands on an open run
    // instead of being dropped (which would otherwise leave that run to be reaped).
    let fallbackUuid = null;
    for (const [uuid, run] of activeTestRuns) {
      if (!run.hasFinished) {
        fallbackUuid = uuid;
      }
    }

    return fallbackUuid;
  }

  // Returns every run that started but was never marked finished, joined with its
  // stored metadata, so the teardown sweep can emit a terminal finish for each.
  static getOpenRuns() {
    const openRuns = [];
    for (const [uuid, run] of activeTestRuns) {
      if (!run.hasFinished) {
        openRuns.push({uuid, ...run});
      }
    }

    return openRuns;
  }

  static markTestFinished(uuid) {
    if (activeTestRuns.has(uuid)) {
      const testRun = activeTestRuns.get(uuid);
      testRun.hasFinished = true;
      testRun.finishedAt = new Date().toISOString();
      activeTestRuns.set(uuid, testRun);
      
      return true;
    }
    
    return false;
  }

  static hasTestFinished(uuid) {
    const testRun = activeTestRuns.get(uuid);

    return testRun ? testRun.hasFinished : false;
  }


  static getTestDetails(identifier) {
    return sharedTestMap.has(identifier) ? sharedTestMap.get(identifier) : null;
  }

  static generateTestIdentifier(test) {
    if (!test) {
      throw new Error('Test object is required to generate identifier');
    }
    const testName = test.testcase;
    const moduleName = test.metadata.name;
    
    return `${moduleName}::${testName}`;
  }
  
  static generateUUID() {
    return uuidv4();
  }
}

module.exports = TestMap;

