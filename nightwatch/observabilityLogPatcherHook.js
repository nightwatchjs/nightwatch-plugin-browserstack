try {
  const {Before} = require('@cucumber/cucumber');
  
  Before((testCase) => {
    console.log(`TEST-OBSERVABILITY-PID-TESTCASE-MAPPING-${testCase.testCaseStartedId}`);
  });

} catch (error) { /* empty */ }
