const {execSync} = require('child_process');

const isCucumberSuite = () => {
  const packages = JSON.parse(execSync('npm ls @cucumber/cucumber --json'));
  if (packages?.dependencies?.['@cucumber/cucumber']) {return true}

  return false;
};

if (isCucumberSuite()) {
  const {Before} = require('@cucumber/cucumber');
  
  Before((testCase) => {
    console.log(`TEST-OBSERVABILITY-PID-TESTCASE-MAPPING-${testCase.testCaseStartedId}`);
  });
}
