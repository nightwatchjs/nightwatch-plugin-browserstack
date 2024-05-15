try {
  const {Before, After} = require('@cucumber/cucumber');
  const testhubUtils = require('@nightwatch/browserstack/src/testHub/utils');

  Before(async (testCase) => {
    await testhubUtils.beforeEachCucumberTest(testCase);
  });

  After(async (testCase) => {
    await testhubUtils.afterEachCucumberTest(testCase);
  });

} catch (error) { /* empty */ }
