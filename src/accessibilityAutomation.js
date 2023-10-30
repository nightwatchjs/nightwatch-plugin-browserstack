const path = require('path');
const helper = require('./utils/helper');
const {makeRequest} = require('./utils/requestHelper');
const Logger = require('./utils/logger');
const {ACCESSIBILITY_URL} = require('./utils/constants');
const util = require('util');

class AccessibilityAutomation {
  configure(settings = {}) {
    this._settings = settings['@nightwatch/browserstack'] || {};

    if (this._settings.accessibility) {
      process.env.BROWSERSTACK_ACCESSIBILITY =
        String(this._settings.accessibility).toLowerCase() === 'true';
    }
    if (process.argv.includes('--disable-accessibility')) {
      process.env.BROWSERSTACK_ACCESSIBILITY = false;

      return;
    }
    process.env.BROWSERSTACK_INFRA = true;
    if (settings && settings.webdriver && settings.webdriver.host && settings.webdriver.host.indexOf('browserstack') === -1){
      process.env.BROWSERSTACK_INFRA = false;
    }

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
      this._user = helper.getUserName(this._settings);
      this._key = helper.getAccessKey(this._settings);
    }
  }

  async createAccessibilityTestRun() {
    const userName = this._user;
    const accessKey = this._key;

    if (helper.isUndefined(userName) || helper.isUndefined(accessKey)) {
      Logger.error(
        'Exception while creating test run for BrowserStack Accessibility Automation: Missing authentication token'
      );

      return [null, null];
    }

    try {
      let accessibilityOptions;
      if (helper.isUndefined(this._settings.accessibilityOptions)) {
        accessibilityOptions = {};
      } else {
        accessibilityOptions = this._settings.accessibilityOptions;
      }

      const fromProduct = {
        accessibility: true
      };

      const data = {
        projectName: helper.getProjectName(this._settings, this._bstackOptions, fromProduct),
        buildName:
          helper.getBuildName(this._settings, this._bstackOptions, fromProduct) ||
          path.basename(path.resolve(process.cwd())),
        startTime: new Date().toISOString(),
        description: accessibilityOptions.buildDescription || '',
        source: {
          frameworkName: helper.getFrameworkName(this._testRunner),
          frameworkVersion: helper.getPackageVersion('nightwatch'),
          sdkVersion: helper.getAgentVersion()
        },
        settings: accessibilityOptions,
        versionControl: await helper.getGitMetaData(),
        ciInfo: helper.getCiInfo(),
        hostInfo: helper.getHostInfo(),
        browserstackAutomation: helper.isBrowserstackInfra()
      };
      const config = {
        auth: {
          user: userName,
          pass: accessKey
        },
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await makeRequest('POST', 'test_runs', data, config, ACCESSIBILITY_URL);
      const responseData = response.data.data || {};

      accessibilityOptions.scannerVersion = responseData.scannerVersion;
      process.env.BROWSERSTACK_ACCESSIBILITY_OPTIONS = JSON.stringify(accessibilityOptions);

      return [responseData.accessibilityToken, responseData.id];
    } catch (error) {
      if (error.response) {
        Logger.error(
          `Exception while creating test run for BrowserStack Accessibility Automation: ${
            error.response.status
          } ${error.response.statusText} ${JSON.stringify(error.response.data)}`
        );
      } else {
        if (error.message === 'Invalid configuration passed.') {
          Logger.error(
            `Exception while creating test run for BrowserStack Accessibility Automation: ${
              error.message || error.stack
            }`
          );
          for (const errorkey of error.errors) {
            Logger.error(errorkey.message);
          }
          process.env.BROWSERSTACK_ACCESSIBILITY = 'false';
        } else {
          Logger.error(
            `Exception while creating test run for BrowserStack Accessibility Automation: ${
              error.message || error.stack
            }`
          );
        }
      }

      return [null, null];
    }
  }

  async stopAccessibilityTestRun() {
    if (
      helper.isUndefined(process.env.BS_A11Y_JWT) ||
      typeof process.env.BS_A11Y_JWT !== 'string'
    ) {
      return {
        status: 'error',
        message: 'Build creation had failed.'
      };
    }

    const data = {endTime: new Date().toISOString()};
    const config = {
      headers: {
        Authorization: `Bearer ${process.env.BS_A11Y_JWT}`,
        'Content-Type': 'application/json'
      }
    };
    const options = {
      ...config,
      ...{
        body: data,
        auth: null,
        json: true
      }
    };

    try {
      const response = await makeRequest(
        'PUT',
        'test_runs/stop',
        options,
        config,
        ACCESSIBILITY_URL
      );
      if (response.data.error) {
        throw new Error('Invalid request: ' + response.data.error);
      } else {
        Logger.info(
          `BrowserStack Accessibility Automation Test Run marked as completed at ${new Date().toISOString()}`
        );

        return {status: 'success', message: ''};
      }
    } catch (error) {
      if (error.response) {
        Logger.error(
          `Exception while marking completion of BrowserStack Accessibility Automation Test Run: ${
            error.response.status
          } ${error.response.statusText} ${JSON.stringify(error.response.data)}`
        );
      } else {
        Logger.error(
          `Exception while marking completion of BrowserStack Accessibility Automation Test Run: ${
            error.message || util.format(error)
          }`
        );
      }

      return {
        status: 'error',
        message:
          error.message ||
          (error.response ? `${error.response.status}:${error.response.statusText}` : error)
      };
    }
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
            this._bstackOptions.accessibilityOptions.authToken = process.env.BS_A11Y_JWT;
          } else {
            this._bstackOptions.accessibilityOptions = {authToken: process.env.BS_A11Y_JWT};
          }
          this._bstackOptions.accessibilityOptions.scannerVersion = JSON.parse(
            process.env.BROWSERSTACK_ACCESSIBILITY_OPTIONS
          ).scannerVersion;
        } else if (settings.desiredCapabilities['browserstack.accessibility']) {
          if (settings.desiredCapabilities['browserstack.accessibilityOptions']) {
            settings.desiredCapabilities['browserstack.accessibilityOptions'].authToken =
              process.env.BS_A11Y_JWT;
          } else {
            settings.desiredCapabilities['browserstack.accessibilityOptions'] = {
              authToken: process.env.BS_A11Y_JWT
            };
          }
          settings.desiredCapabilities['browserstack.accessibilityOptions'].scannerVersion = JSON.parse(
            process.env.BROWSERSTACK_ACCESSIBILITY_OPTIONS
          ).scannerVersion;
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
        typeof process.env.BS_A11Y_JWT === 'string' &&
        process.env.BS_A11Y_JWT.length > 0 &&
        process.env.BS_A11Y_JWT !== 'null';

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

  fetchPlatformDetails(driver) {
    let response = {};
    try {
      response = {
        os_name: driver.capabilities.platformName,
        os_version: helper.getPlatformVersion(driver),
        browser_name: driver.capabilities.browserName,
        browser_version: driver.capabilities.browserVersion
      };
    } catch (error) {
      Logger.debug(`Exception in fetching platform details with error : ${error}`);
    }

    return response;
  }

  setExtension(driver) {
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
      Logger.debug(`Exception in setExtension Error: ${error}`);
    }

    return false;
  }

  async beforeEachExecution(testMetaData) {
    try {
      this.currentTest = browser.currentTest;
      this.currentTest.shouldScanTestForAccessibility = this.shouldScanTestForAccessibility(
        testMetaData
      );
      this.currentTest.accessibilityScanStarted = true;
      this._isAccessibilitySession = this.setExtension(browser);

      if (this.isAccessibilityAutomationSession() && browser && helper.isAccessibilitySession() && this._isAccessibilitySession) {
        try {
          const session = await browser.session();
          if (session) {
            let pageOpen = true;
            const currentURL = await browser.driver.getCurrentUrl();

            let url = {};
            try {
              url = new URL(currentURL);
              pageOpen = true;
            } catch (e) {
              pageOpen = false;
            }
            pageOpen = url.protocol === 'http:' || url.protocol === 'https:';

            if (pageOpen) {
              if (this.currentTest.shouldScanTestForAccessibility) {
                Logger.info(
                  'Setup for Accessibility testing has started. Automate test case execution will begin momentarily.'
                );

                await browser.executeAsyncScript(`
                const callback = arguments[arguments.length - 1];
                const fn = () => {
                  window.addEventListener('A11Y_TAP_STARTED', fn2);
                  const e = new CustomEvent('A11Y_FORCE_START');
                  window.dispatchEvent(e);
                };
                const fn2 = () => {
                  window.removeEventListener('A11Y_TAP_STARTED', fn);
                  callback();
                }
                fn();
              `);
              } else {
                await browser.executeScript(`
                const e = new CustomEvent('A11Y_FORCE_STOP');
                window.dispatchEvent(e);
              `);
              }
            }
            this.currentTest.accessibilityScanStarted =
              this.currentTest.shouldScanTestForAccessibility;
            if (this.currentTest.shouldScanTestForAccessibility) {
              Logger.info('Automate test case execution has started.');
            }
          }
        } catch (e) {
          Logger.error('Exception in starting accessibility automation scan for this test case', e);
        }
      }
    } catch (err) {
      Logger.error('Exception in starting accessibility automation scan for this test case', err);
    }
  }

  async afterEachExecution(testMetaData) {
    try {
      if (this.currentTest.accessibilityScanStarted && this.isAccessibilityAutomationSession() && this._isAccessibilitySession) {
        if (this.currentTest.shouldScanTestForAccessibility) {
          Logger.info(
            'Automate test case execution has ended. Processing for accessibility testing is underway. '
          );
        }
        const dataForExtension = {
          saveResults: this.currentTest.shouldScanTestForAccessibility,
          testDetails: {
            name: testMetaData.testcase,
            testRunId: process.env.BS_A11Y_TEST_RUN_ID,
            filePath: testMetaData.metadata.modulePath,
            scopeList: [testMetaData.metadata.name, testMetaData.testcase]
          },
          platform: await this.fetchPlatformDetails(browser)
        };
        const final_res = await browser.executeAsyncScript(
          `
            const callback = arguments[arguments.length - 1];

            this.res = null;
            if (arguments[0].saveResults) {
              window.addEventListener('A11Y_TAP_TRANSPORTER', (event) => {
                window.tapTransporterData = event.detail;
                this.res = window.tapTransporterData;
                callback(this.res);
              });
            }
            const e = new CustomEvent('A11Y_TEST_END', {detail: arguments[0]});
            window.dispatchEvent(e);
            if (arguments[0].saveResults !== true ) {
              callback();
            }
          `,
          dataForExtension
        );
        if (this.currentTest.shouldScanTestForAccessibility) {
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
      const results = await browser.executeScript(`
        return new Promise(function (resolve, reject) {
          try {
            const event = new CustomEvent('A11Y_TAP_GET_RESULTS');
            const fn = function (event) {
              window.removeEventListener('A11Y_RESULTS_RESPONSE', fn);
              resolve(event.detail.data);
            };
            window.addEventListener('A11Y_RESULTS_RESPONSE', fn);
            window.dispatchEvent(event);
          } catch {
            reject();
          }
        });
      `);

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
      const summaryResults = await browser.executeScript(`
        return new Promise(function (resolve, reject) {
          try{
            const event = new CustomEvent('A11Y_TAP_GET_RESULTS_SUMMARY');
            const fn = function (event) {
                window.removeEventListener('A11Y_RESULTS_SUMMARY_RESPONSE', fn);
                resolve(event.detail.summary);
            };
            window.addEventListener('A11Y_RESULTS_SUMMARY_RESPONSE', fn);
            window.dispatchEvent(event);
          } catch {
            reject();
          }
        });
      `);

      return summaryResults;
    } catch {
      Logger.error('No accessibility summary was found.');

      return {};
    }
  }

  filterAccessibilityOptions(accessibilityOptions) {
    return Object.fromEntries(Object.entries(accessibilityOptions).filter(([k, v]) => !(k.toLowerCase() === 'excludetagsintestingscope' || k.toLowerCase() === 'includetagsintestingscope')));
  }

}

module.exports = AccessibilityAutomation;
