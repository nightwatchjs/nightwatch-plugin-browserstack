const path = require('path');
const helper = require('./utils/helper');
const Logger = require('./utils/logger');
const {APP_ALLY_ENDPOINT,APP_ALLY_ISSUES_SUMMARY_ENDPOINT,APP_ALLY_ISSUES_ENDPOINT} = require('./utils/constants');
const util = require('util');
const AccessibilityScripts = require('./scripts/accessibilityScripts');

class AccessibilityAutomation {
  static pendingAllyReq = 0;
  configure(settings = {}) {
    this._settings = settings['@nightwatch/browserstack'] || {};
    this._testRunner = settings.test_runner;
    this._bstackOptions = {};
    if (
      settings &&
      settings.desiredCapabilities &&
      settings.desiredCapabilities['bstack:options']
    ) {
      this._bstackOptions = settings.desiredCapabilities['bstack:options'];
    }

    if (this._settings.accessibility || this._bstackOptions) {
      this._user = helper.getUserName(settings, this._settings);
      this._key = helper.getAccessKey(settings, this._settings);
    }

    const accessibilityOptions = helper.isUndefined(this._settings.accessibilityOptions) 
      ? {} 
      : this._settings.accessibilityOptions;
    process.env.BROWSERSTACK_ACCESSIBILITY_OPTIONS = JSON.stringify(accessibilityOptions);
  }

  setAccessibilityCapabilities(settings) {
    try {
      settings.desiredCapabilities = settings.desiredCapabilities || {};
      this._settings = this._settings || settings['@nightwatch/browserstack'] || {};
      if (
        settings &&
        settings.desiredCapabilities &&
        settings.desiredCapabilities['bstack:options']
      ) {
        this._bstackOptions = this._bstackOptions || settings.desiredCapabilities['bstack:options'];
      }
      if (helper.isUndefined(this._settings.accessibilityOptions)) {
        this._bstackOptions.accessibilityOptions = {};
      } else {
        this._bstackOptions.accessibilityOptions = this.filterAccessibilityOptions(this._settings.accessibilityOptions);
      }
      if (
        (this._settings && this._settings.accessibility) ||
        settings.desiredCapabilities['browserstack.accessibility']
      ) {
        global.isAccessibilityPlatform = true;
        // condition for adding capability for w3c caps
        if (this._bstackOptions) {
          this._bstackOptions.accessibility = this._settings.accessibility;
          if (this._bstackOptions.accessibilityOptions) {
            this._bstackOptions.accessibilityOptions.authToken = process.env.BSTACK_A11Y_JWT;
          } else {
            this._bstackOptions.accessibilityOptions = {authToken: process.env.BSTACK_A11Y_JWT};
          }
          this._bstackOptions.accessibilityOptions.scannerVersion = process.env.BSTACK_A11Y_SCANNER_VERSION; 
        } else if (settings.desiredCapabilities['browserstack.accessibility']) {
          if (settings.desiredCapabilities['browserstack.accessibilityOptions']) {
            settings.desiredCapabilities['browserstack.accessibilityOptions'].authToken =
              process.env.BSTACK_A11Y_JWT;
          } else {
            settings.desiredCapabilities['browserstack.accessibilityOptions'] = {
              authToken: process.env.BSTACK_A11Y_JWT
            };
          }
          settings.desiredCapabilities['browserstack.accessibilityOptions'].scannerVersion = process.env.BSTACK_A11Y_SCANNER_VERSION;
        }
      }
    } catch (e) {
      Logger.debug(`Exception while setting Accessibility Automation capabilities. Error ${e}`);
    }
  }

  isAccessibilityAutomationSession() {
    try {
      if (!helper.isBrowserstackInfra()) {
        return false; // since we are running only on Automate as of now
      }
      const isBrowserstackAccessibilityEnabled = process.env.BROWSERSTACK_ACCESSIBILITY === 'true';
      const hasA11yJwtToken =
        typeof process.env.BSTACK_A11Y_JWT === 'string' &&
        process.env.BSTACK_A11Y_JWT.length > 0 &&
        process.env.BSTACK_A11Y_JWT !== 'null';

      return isBrowserstackAccessibilityEnabled && hasA11yJwtToken;
    } catch (error) {
      Logger.debug(`Exception in verifying the Accessibility session with error : ${error}`);
    }

    return false;
  }

  shouldScanTestForAccessibility(testMetaData) {
    if (process.env.BROWSERSTACK_ACCESSIBILITY_OPTIONS == null) {
      return true;
    }
    try {
      const accessibilityConfig = JSON.parse(process.env.BROWSERSTACK_ACCESSIBILITY_OPTIONS);
      const includeTags = Array.isArray(accessibilityConfig.includeTagsInTestingScope)
        ? accessibilityConfig.includeTagsInTestingScope
        : [];
      const excludeTags = Array.isArray(accessibilityConfig.excludeTagsInTestingScope)
        ? accessibilityConfig.excludeTagsInTestingScope
        : [];

      const fullTestName = testMetaData.testcase;
      const excluded = excludeTags.some((exclude) => fullTestName.includes(exclude));
      const included =
        includeTags.length === 0 || includeTags.some((include) => fullTestName.includes(include));

      return !excluded && included;
    } catch (error) {
      Logger.debug(
        'Error while validating test case for accessibility before scanning. Error : ',
        error
      );
    }

    return false;
  }

  validateA11yCaps(driver) {
    try {
      const capabilityConfig = driver.desiredCapabilities || {};
      const deviceName = driver.capabilities.deviceName || (capabilityConfig['bstack:options'] ? capabilityConfig['bstack:options'].deviceName : capabilityConfig.device) || '';

      if (deviceName !== '') {
        Logger.warn('Accessibility Automation will run only on Desktop browsers.');

        return false;
      }
      const browser = driver.capabilities.browserName || (capabilityConfig['bstack:options'] ? capabilityConfig['bstack:options'].browserName : capabilityConfig.browser) || '';
      if (browser.toLowerCase() !== 'chrome') {
        Logger.warn('Accessibility Automation will run only on Chrome browsers.');

        return false;
      }
      const browserVersion = driver.capabilities.browserVersion || (capabilityConfig['bstack:options'] ? capabilityConfig['bstack:options'].browserVersion : capabilityConfig.browser_version) || '';
      if (!helper.isUndefined(browserVersion) && !(browserVersion === 'latest'  ||  parseInt(browserVersion) > 94)) {
        Logger.warn('Accessibility Automation will run only on Chrome browser version greater than 94.');

        return false;
      }

      const chromeOptions = capabilityConfig.chromeOptions || capabilityConfig['goog:chromeOptions'] || {};
      if (chromeOptions.args?.includes('--headless') || chromeOptions.args?.includes('headless')) {
        Logger.warn('Accessibility Automation will not run on legacy headless mode. Switch to new headless mode or avoid using headless mode.');

        return false;
      }

      return true;
    } catch (error) {
      Logger.debug(`Exception in validateA11yCaps Error: ${error}`);
    }

    return false;
  }

  validateAppA11yCaps(capabilities = {}) {
    /* Check if the current driver platform is eligible for AppAccessibility scan */
    if (
        capabilities?.platformName &&
        String(capabilities?.platformName).toLowerCase() === 'android' &&
        capabilities?.platformVersion &&
        parseInt(capabilities?.platformVersion?.toString()) < 11
    ) {
        Logger.warn(
            'App Accessibility Automation tests are supported on OS version 11 and above for Android devices.'
        );
        return false;
    }
    return true;
  }

  async beforeEachExecution(testMetaData) {
    try {
      this.currentTest = browser.currentTest;
      this.currentTest.shouldScanTestForAccessibility = this.shouldScanTestForAccessibility(
        testMetaData
      );
      this.currentTest.accessibilityScanStarted = true;

      this._isAppAccessibility = helper.isAppAccessibilitySession();
      if (this._isAppAccessibility) {
        this._isAccessibilitySession = this.validateAppA11yCaps(testMetaData.metadata.sessionCapabilities);
      } else {
        this._isAccessibilitySession = this.validateA11yCaps(browser);
      }

      if (this.isAccessibilityAutomationSession() && browser && this._isAccessibilitySession) {
        try { 
          this.currentTest.accessibilityScanStarted =
              this.currentTest.shouldScanTestForAccessibility;
          if (this.currentTest.shouldScanTestForAccessibility) {
            Logger.info('Automate test case execution has started.');
          }
        } catch (e) {
          Logger.error('Exception in starting accessibility automation scan for this test case', e);
        }
      }
    } catch (err) {
      Logger.error('Exception in starting accessibility automation scan for this test case', err);
    }
  }

  async afterEachExecution(testMetaData, uuid) {
    try {
      if (this.currentTest.accessibilityScanStarted && this.isAccessibilityAutomationSession() && this._isAccessibilitySession) {
        if (this.currentTest.shouldScanTestForAccessibility) {
          Logger.info(
            'Automate test case execution has ended. Processing for accessibility testing is underway. '
          );
        
          const dataForExtension = {
            'thTestRunUuid': uuid,
            'thBuildUuid': process.env.BROWSERSTACK_TESTHUB_UUID,
            'thJwtToken': process.env.BROWSERSTACK_TESTHUB_JWT
          };
          AccessibilityAutomation.pendingAllyReq++;
          await this.saveAccessibilityResults(browser, dataForExtension);
          AccessibilityAutomation.pendingAllyReq--;
          Logger.info('Accessibility testing for this test case has ended.');          
        }
      }
    } catch (er) {
      Logger.error(
        `Accessibility results could not be processed for the test case ${this.currentTest.module}. Error :`,
        er
      );
    }
  }

  async getAccessibilityResults() {
    if (!this.isAccessibilityAutomationSession() || !this._isAccessibilitySession) {
      Logger.warn('Not a Accessibility Automation session, cannot retrieve Accessibility results.');

      return {};
    }
    try {
      Logger.debug('Performing scan before getting results');
      await this.performScan(browser);
      const results = await browser.executeAsyncScript(AccessibilityScripts.getResults);

      return results;
    } catch {
      Logger.error('No accessibility results were found.');

      return {};
    }
  }

  async getAccessibilityResultsSummary() {
    if (!this.isAccessibilityAutomationSession() || !this._isAccessibilitySession) {
      Logger.warn(
        'Not a Accessibility Automation session, cannot retrieve Accessibility results summary.'
      );

      return {};
    }
    try {
      Logger.debug('Performing scan before getting results summary');
      await this.performScan(browser);
      const summaryResults = await browser.executeAsyncScript(AccessibilityScripts.getResultsSummary);

      return summaryResults;
    } catch {
      Logger.error('No accessibility summary was found.');

      return {};
    }
  }

  filterAccessibilityOptions(accessibilityOptions) {
    return Object.fromEntries(Object.entries(accessibilityOptions).filter(([k, v]) => !(k.toLowerCase() === 'excludetagsintestingscope' || k.toLowerCase() === 'includetagsintestingscope')));
  }

  async performScan(browserInstance = null, commandName = '') {
    
    if (!this.isAccessibilityAutomationSession() || !this._isAccessibilitySession) {
      Logger.warn('Not an Accessibility Automation session, cannot perform Accessibility scan.');
      return;
    }

    if (this.currentTest.shouldScanTestForAccessibility === false) {
      return;
    }

    try {
      const browser = browserInstance;
        
      if (!browser) {
        Logger.error('No browser instance available for accessibility scan');

        return;
      }

      if (helper.isAppAccessibilitySession()){
        const results = await browser.executeScript(
          helper.formatString(AccessibilityScripts.performScan, JSON.stringify(this.getParamsForAppAccessibility(commandName))),
          {}
        );
        Logger.debug(util.inspect(results));
        return results;
      }
      AccessibilityAutomation.pendingAllyReq++;
      const results = await browser.executeAsyncScript(AccessibilityScripts.performScan, { 
        method: commandName || '' 
      });
      AccessibilityAutomation.pendingAllyReq--;
      Logger.debug(util.inspect(results));

      return results;

    } catch (err) {
      AccessibilityAutomation.pendingAllyReq--;
      Logger.error('Accessibility Scan could not be performed: ' + err.message);
      Logger.debug('Stack trace:', err.stack);

      return;
    }
  }

  async getAppAccessibilityResults(browser) {
    if (!helper.isBrowserstackInfra()) {
      return [];
    }

    if (!helper.isAppAccessibilitySession()) {
      Logger.warn('Not an Accessibility Automation session, cannot retrieve Accessibility results summary.')
        return [];
    }

    try {
        const apiUrl = `${APP_ALLY_ENDPOINT}/${APP_ALLY_ISSUES_ENDPOINT}`;
        const apiRespone = await this.getAppA11yResultResponse(apiUrl, browser, browser.sessionId);
        const result = apiRespone?.data?.data?.issues;
        Logger.debug(`Polling Result: ${JSON.stringify(result)}`);
        return result;
    } catch (error) {
        Logger.error('No accessibility summary was found.');
        Logger.debug(`getAppA11yResults Failed. Error: ${error}`);
        return [];
    }

  }

  async getAppAccessibilityResultsSummary(browser) {
    if (!helper.isBrowserstackInfra()) {
      return {}; 
    }

    if (!helper.isAppAccessibilitySession()) {
      Logger.warn('Not an Accessibility Automation session, cannot retrieve Accessibility results summary.')
        return {}
    }
    try {
        const apiUrl = `${APP_ALLY_ENDPOINT}/${APP_ALLY_ISSUES_SUMMARY_ENDPOINT}`;
        const apiRespone = await this.getAppA11yResultResponse(apiUrl, browser, browser.sessionId);
        const result = apiRespone?.data?.data?.summary;
        Logger.debug(`Polling Result: ${JSON.stringify(result)}`);
        return result;
    } catch {
        Logger.error('No accessibility summary was found.');
        return {};
    }
  }

  async getAppA11yResultResponse(apiUrl, browser, sessionId){
    Logger.debug('Performing scan before getting results/results summary');
    await this.performScan(browser);
    
    const upperTimeLimit = process.env.BSTACK_A11Y_POLLING_TIMEOUT ? Date.now() + parseInt(process.env.BSTACK_A11Y_POLLING_TIMEOUT) * 1000 : Date.now() + 30000;
    const params = { test_run_uuid: process.env.TEST_RUN_UUID, session_id: sessionId, timestamp: Date.now() }; // Query params to pass
    const header = { Authorization: `Bearer ${process.env.BSTACK_A11Y_JWT}` };
    const apiRespone = await helper.pollApi(apiUrl, params, header, upperTimeLimit);
    Logger.debug(`Polling Result: ${JSON.stringify(apiRespone)}`);
    return apiRespone;

  }


  async saveAccessibilityResults(browser, dataForExtension = {}) {
    Logger.debug('Performing scan before saving results');
    await this.performScan(browser);
    if (helper.isAppAccessibilitySession()){
        return;
    }
    const results = await browser.executeAsyncScript(AccessibilityScripts.saveTestResults, dataForExtension);
    Logger.debug(util.inspect(results)); 
  }

  async commandWrapper() {
    const nightwatchMain = require.resolve('nightwatch');
    const nightwatchDir = path.dirname(nightwatchMain);
   
    const commandJson = AccessibilityScripts.commandsToWrap;
    const accessibilityInstance = this;
    for (const commandKey in commandJson) { 
      if (commandJson[commandKey].method === 'protocolAction'){
        commandJson[commandKey].name.forEach(commandName => {
          try {
            const commandPath = path.join(nightwatchDir, `${commandJson[commandKey].path}`, `${commandName}.js`);
            const OriginalClass = require(commandPath);
            const originalProtocolAction = OriginalClass.prototype.protocolAction;
            
            OriginalClass.prototype.protocolAction = async function() {
              await accessibilityInstance.performScan(browser, commandName);

              return originalProtocolAction.apply(this);
            };
          } catch (error) {
            Logger.debug(`Failed to patch protocolAction for command ${commandName}`);
          }
        });
      } else {
        commandJson[commandKey].name.forEach(commandName => {
          try {
            const webElementCommandPath = path.join(nightwatchDir, `${commandJson[commandKey].path}`, `${commandName}.js`);
            const originalCommand = require(webElementCommandPath);
            const originalCommandFn = originalCommand.command;

            originalCommand.command = async function(...args) {
              if (
                !commandName.includes('execute') ||
                !accessibilityInstance.shouldPatchExecuteScript(args.length ? args[0] : null)
              ) {
                await accessibilityInstance.performScan(browser, commandName);
              }

              return originalCommandFn.apply(this, args);
            };
          } catch (error) {
            Logger.debug(`Failed to patch command ${commandName}`);
          }
        });
      }
    }
  }

  shouldPatchExecuteScript(script) {
    if (!script || typeof script !== 'string') {
      return true;
    }

    return (
      script.toLowerCase().indexOf('browserstack_executor') !== -1 ||
      script.toLowerCase().indexOf('browserstack_accessibility_automation_script') !== -1
    );
  }

  getParamsForAppAccessibility(commandName) {
    return {
      'thTestRunUuid': process.env.TEST_RUN_UUID,
      'thBuildUuid': process.env.BROWSERSTACK_TESTHUB_UUID,
      'thJwtToken': process.env.BROWSERSTACK_TESTHUB_JWT,
      'authHeader': process.env.BSTACK_A11Y_JWT,
      'scanTimestamp': Date.now(),
      'method': commandName
    };
  }
}

module.exports = AccessibilityAutomation;
