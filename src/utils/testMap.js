const {v4: uuidv4} = require('uuid');

const sharedTestMap = new Map();
let sharedCurrentTest = null;

class TestMap {
  
  static storeTestDetails(test) {
    const testIdentifier = this.generateTestIdentifier(test);
    
    if (!sharedTestMap.has(testIdentifier)) {
      const uuid = this.generateUUID();
      sharedTestMap.set(testIdentifier, {
        uuid,
        test,
        createdAt: new Date().toISOString()
      });
    }
    sharedCurrentTest = testIdentifier;
  }

  static getUUID(test = null) {
    if (test) {
      const testIdentifier = typeof test === 'string' ? test : this.generateTestIdentifier(test);
      const testData = sharedTestMap.get(testIdentifier);

      return testData ? testData.uuid : null;
    }
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

