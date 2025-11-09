const path = require('path');
const helper = require('./utils/helper');
const {makeRequest} = require('./utils/requestHelper');
const Logger = require('./utils/logger');
const {ACCESSIBILITY_URL} = require('./utils/constants');
const util = require('util');

class AccessibilityAutomation {
  configure(settings = {}) {
    if (process.argv.includes('--disable-accessibility')) {
      process.env.BROWSERSTACK_ACCESSIBILITY = false;
      return;
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
      this._user = helper.getUserName(settings, this._settings);
      this._key = helper.getAccessKey(settings, this._settings);
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

  async beforeEachExecution(testMetaData) {
    try {
      this.currentTest = browser.currentTest;
      this.currentTest.shouldScanTestForAccessibility = this.shouldScanTestForAccessibility(
        testMetaData
      );
      this.currentTest.accessibilityScanStarted = true;
      this._isAccessibilitySession = this.validateA11yCaps(browser);

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
                await browser.executeAsyncScript(`
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
