try {
  const {Before, After} = require('@cucumber/cucumber');
  const nightwatchPluginHelper = require('@nightwatch/browserstack/src/utils/helper');
  const AccessibilityAutomation = require('@nightwatch/browserstack/src/accessibilityAutomation');

  Before(async (testCase) => {
    nightwatchPluginHelper.modifySeleniumCommands();
    nightwatchPluginHelper.modifyNightwatchCommands();
    console.log(`TEST-OBSERVABILITY-PID-TESTCASE-MAPPING-${testCase.testCaseStartedId}`);
    const testMeta = nightwatchPluginHelper.getCucumberTestMetaData(testCase);
    await AccessibilityAutomation.prototype.beforeEachExecution(testMeta);
  });

  After(async (testCase) => {
    const testMeta = nightwatchPluginHelper.getCucumberTestMetaData(testCase);
    await AccessibilityAutomation.prototype.afterEachExecution(testMeta);
  });

} catch (error) { /* empty */ }
