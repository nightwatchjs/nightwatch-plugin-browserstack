const { v4: uuidv4 } = require('uuid');

class TestMap {
  constructor() {
    this.testMap = new Map();
    this.currentTest = null;
  }

  storeTestDetails(test) {
    const testIdentifier = this.generateTestIdentifier(test);
    
    if (!this.testMap.has(testIdentifier)) {
      const uuid = this.generateUUID();
      this.testMap.set(testIdentifier, {
        uuid,
        test,
        createdAt: new Date().toISOString()
      });
    }
    this.currentTest = testIdentifier;
  }

  getUUID(test = null) {
    if (test) {
      const testIdentifier = typeof test === 'string' ? test : this.generateTestIdentifier(test);
      const testData = this.testMap.get(testIdentifier);
      return testData ? testData.uuid : null;
    }
  }

  getTestDetails(identifier) {
    if (this.testMap.has(identifier)) {
      return this.testMap.get(identifier);
    }
    return null;
  }

  generateTestIdentifier(test) {
    if (!test) {
      throw new Error('Test object is required to generate identifier');
    }
    const testName = test.testcase;
    const moduleName = test.metadata.name;
    
    return `${moduleName}::${testName}`;
  }
  
  generateUUID() {
    return uuidv4();
  }

  getAllTests() {
    return new Map(this.testMap);
  }
}

module.exports = TestMap;

