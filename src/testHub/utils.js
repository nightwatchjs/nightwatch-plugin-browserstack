const helper = require('../utils/helper');
const logger = require('../utils/logger');
const constants = require('../utils/constants');
const scripts = require('../utils/scripts');
const AccessibilityAutomation = require('../accessibilityAutomation');

exports.getFrameworkDetails = (testRunner) => {
  return {
    frameworkName: helper.getFrameworkName(testRunner),
    frameworkVersion: helper.getPackageVersion('nightwatch'),
    sdkVersion: helper.getAgentVersion(),
    language: 'javascript',
    testFramework: {
      name: 'selenium',
      version: helper.getPackageVersion('selenium-webdriver')
    }
  };
};

exports.getProductMap = () => {
  return {
    'observability': helper.isTestObservabilitySession(),
    'accessibility': helper.isAccessibilitySession(),
    'percy': false,
    'automate': helper.isBrowserstackInfra(),
    'app_automate': false
  };
};

exports.shouldProcessEventForTestHub = () => {
  // Do not run build Unification for accessibility
  if (!helper.isCucumberTestSuite()) {return false};

  return helper.isTestObservabilitySession() || helper.isAccessibilitySession();
};

exports.shouldUploadEventToTestHub = (eventType) => {
  if (!helper.isCucumberTestSuite()) {return true};
  
  if (helper.isAccessibilitySession() && !helper.isTestObservabilitySession()) {
    if (['TestRunFinished', 'TestRunStarted'].includes(eventType)) {
      return true;
    }

    return false;
  }

  return helper.isTestObservabilitySession() || helper.isAccessibilitySession();
};

exports.setTestObservabilityVariables = (responseData) => {
  if (!responseData.observability) {
    exports.handleErrorForObservability();

    return [null, null, null];
  }

  if (!responseData.observability.success) {
    exports.handleErrorForObservability(responseData.observability);

    return [null, null, null];
  }

  if (helper.isTestObservabilitySession()) {
    process.env.BS_TESTOPS_BUILD_COMPLETED = 'true';
    if (responseData.jwt) {
      process.env.BS_TESTOPS_JWT = responseData.jwt;
    }
    if (responseData.build_hashed_id) {
      process.env.BS_TESTOPS_BUILD_HASHED_ID = responseData.build_hashed_id;
    }
    if (responseData.observability.options) {
      process.env.BS_TESTOPS_ALLOW_SCREENSHOTS = responseData.observability.options.allow_screenshots.toString();
    }
    logger.info(`Build Created Successfully with hashed id: ${responseData.build_hashed_id}`);

    return [responseData.jwt, responseData.build_hashed_id, process.env.BS_TESTOPS_ALLOW_SCREENSHOTS];
  }

  return [null, null, null];
};

exports.setAccessibilityVariables = (responseData, requestData) => {
  if (!responseData.accessibility) {
    exports.handleErrorForAccessibility();

    return [null, null];
  }

  if (!responseData.accessibility.success) {
    exports.handleErrorForAccessibility(responseData.accessibility);

    return [null, null];
  }

  if (responseData?.accessibility?.options) {
    const {accessibilityToken, scannerVersion} = jsonifyAccessibilityArray(responseData.accessibility.options.capabilities, 'name', 'value');
    const scriptsJson = {'scripts': jsonifyAccessibilityArray(responseData.accessibility.options.scripts, 'name', 'command')};
    scriptsJson['commands'] = responseData.accessibility.options.commandsToWrap.commands;
    scripts.parseFromJson(scriptsJson);
    scripts.toJson();
    const accessibilityOptions = requestData.accessibility;
    accessibilityOptions.scannerVersion = scannerVersion;
    process.env.BROWSERSTACK_ACCESSIBILITY_OPTIONS = JSON.stringify(accessibilityOptions);
    process.env.BS_A11Y_JWT = accessibilityToken;
    logger.info(`Build Created Successfully with hashed id: ${responseData.build_hashed_id}`);

    return [accessibilityToken, responseData.build_hashed_id];
  }

  return [null, null];
};

exports.handleErrorForObservability = (error) => {
  process.env.BROWSERSTACK_TESTHUB_UUID = 'null';
  process.env.BROWSERSTACK_TESTHUB_JWT = 'null';
  process.env.BROWSERSTACK_TEST_OBSERVABILITY = 'false';
  process.env.BS_TESTOPS_BUILD_COMPLETED = 'false';
  process.env.BS_TESTOPS_JWT = 'null';
  process.env.BS_TESTOPS_BUILD_HASHED_ID = 'null';
  process.env.BS_TESTOPS_ALLOW_SCREENSHOTS = 'null';
  exports.logBuildError(error, 'observability');
};

exports.handleErrorForAccessibility = (error) => {
  process.env.BROWSERSTACK_TESTHUB_UUID = 'null';
  process.env.BROWSERSTACK_TESTHUB_JWT = 'null';
  process.env.BROWSERSTACK_TEST_ACCESSIBILITY_YML = 'false';
  process.env.BROWSERSTACK_TEST_ACCESSIBILITY_PLATFORM = 'false';
  exports.logBuildError(error, 'accessibility');
};

exports.logBuildError = (error, product = '') => {
  if (error === undefined) {
    logger.error(`${product.toUpperCase()} Build creation failed`);

    return;
  }

  for (const errorJson of error.errors) {
    const errorType = errorJson.key;
    const errorMessage = errorJson.message;
    if (errorMessage) {
      switch (errorType) {
        case constants.TESTHUB_ERROR.INVALID_CREDENTIALS:
          logger.error(errorMessage);
          break;
        case constants.TESTHUB_ERROR.ACCESS_DENIED:
          logger.info(errorMessage);
          break;
        case constants.TESTHUB_ERROR.DEPRECATED:
          logger.error(errorMessage);
          break;
        default:
          logger.error(errorMessage);
      }
    }
  }
};

// To handle array of json, eg: [{keyName : '', valueName : ''}]
const jsonifyAccessibilityArray = (dataArray, keyName, valueName) => {
  const result = {};
  dataArray.forEach(element => {
    result[element[keyName]] = element[valueName];
  });

  return result;
};

exports.setTestHubCommonMetaInfo = (responseData) => {
  if (responseData.jwt) {
    process.env.BROWSERSTACK_TESTHUB_JWT = responseData.jwt;
  }
  if (responseData.build_hashed_id) {
    process.env.BROWSERSTACK_TESTHUB_UUID = responseData.build_hashed_id;
  };
};

exports.beforeEachCucumberTest = async (testCase) => {
  console.log(`TEST-OBSERVABILITY-PID-TESTCASE-MAPPING-${testCase.testCaseStartedId}`);

  if (helper.isAccessibilitySession()) {
    helper.modifySeleniumCommands();
    helper.modifyNightwatchCommands();
    const testMeta = helper.getCucumberTestMetaData(testCase);
    await AccessibilityAutomation.prototype.beforeEachExecution(testMeta);
  }
};

exports.afterEachCucumberTest = async (testCase) => {
  if (helper.isAccessibilitySession()) {
    const testMeta = helper.getCucumberTestMetaData(testCase);
    await AccessibilityAutomation.prototype.afterEachExecution(testMeta);
  }
};
