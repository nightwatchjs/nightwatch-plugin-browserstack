const {v4: uuidv4} = require('uuid');

const sharedTestMap = new Map();
let sharedCurrentTest = null;
let activeTestRuns = new Map(); 

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

  static getUUID(test = null) {
    if (test) {
      const testIdentifier = typeof test === 'string' ? test : this.generateTestIdentifier(test);
      const testData = sharedTestMap.get(testIdentifier);

      return testData ? testData.currentUuid : null;
    }
    
    return null;
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

