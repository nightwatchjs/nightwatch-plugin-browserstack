const helper = require('../utils/helper');
const CrashReporter = require('../utils/crashReporter');
const Logger = require('../utils/logger');
const testHubUtils = require('./utils');
const {makeRequest} = require('../utils/requestHelper');
const constants = require('../utils/constants');


class TestHubHandler {
  configure(settings = {}) {
    this._settings = settings['@nightwatch/browserstack'] || {};
    process.env.BROWSERSTACK_INFRA = true;
    if (settings && settings.webdriver && settings.webdriver.host && settings.webdriver.host.indexOf('browserstack') === -1){
      process.env.BROWSERSTACK_INFRA = false;
    }
    this.#configureAccessibility(settings);
    this.#configureObservability(settings);
    this.setCredentials(settings);
  }

  #configureAccessibility(settings) {
    if (this._settings.accessibility) {
      process.env.BROWSERSTACK_ACCESSIBILITY = String(this._settings.accessibility).toLowerCase() === 'true';
    }
    if (process.argv.includes('--disable-accessibility')) {
      process.env.BROWSERSTACK_ACCESSIBILITY = false;

      return;
    }

    this._testRunner = settings.test_runner;
    this._bstackOptions = {};
    if (settings && settings.desiredCapabilities && settings.desiredCapabilities['bstack:options']) {
      this._bstackOptions = settings.desiredCapabilities['bstack:options'];
    }
  }

  #configureObservability(settings) {
    if (this._settings.test_observability) {
      process.env.BROWSERSTACK_TEST_OBSERVABILITY = this._settings.test_observability.enabled;
    }
    if (process.argv.includes('--disable-test-observability')) {
      process.env.BROWSERSTACK_TEST_OBSERVABILITY = false;

      return;
    }

    this._testRunner = settings.test_runner;
    this._bstackOptions = {};
    if (settings && settings.desiredCapabilities && settings.desiredCapabilities['bstack:options']) {
      this._bstackOptions = settings.desiredCapabilities['bstack:options'];
    }

    if (helper.isCucumberTestSuite(settings)) {
      process.env.CUCUMBER_SUITE = 'true';
    }

  }

  async launchBuild() {
    try {
      const data = await this.generateBuildUpstreamData();
      const config = this.#getConfig();
      // Logger.info('DATA => ' + JSON.stringify(data));
      const response = await makeRequest('POST', constants.TH_BUILD_API, data, config, constants.API_URL);
      // Logger.info('Build Response :' + JSON.stringify(response));
      this.extractDataFromResponse(response, data);

    } catch (error) {
      Logger.error(error);
    }
  }

  async generateBuildUpstreamData() {
    const options = this._settings.test_observability || {};
    
    const data = {
      'project_name': helper.getProjectName(this._settings),
      'name': helper.getBuildName(this._settings, this._bstackOptions, testHubUtils.getProductMap),
      'build_identifier': options.buildIdentifier,
      'description': options.buildDescription || '',
      'started_at': new Date().toISOString(),
      'tags': helper.getObservabilityBuildTags(this._settings, this._bstackOptions),
      'host_info': helper.getHostInfo(),
      'ci_info': helper.getCiInfo(),
      'build_run_identifier': process.env.BROWSERSTACK_BUILD_RUN_IDENTIFIER,
      'failed_tests_rerun': process.env.BROWSERSTACK_RERUN || false,
      'version_control': await helper.getGitMetaData(),
      'accessibility': this.getAccessibilityOptions(),
      'framework_details': testHubUtils.getFrameworkDetails(this._testRunner),
      'product_map': testHubUtils.getProductMap(),
      'browserstackAutomation': helper.isBrowserstackInfra()
    };

    return data;
  }

  #getConfig() {
    return {
      auth: {
        username: this._user,
        password: this._key
      },
      headers: {
        'Content-Type': 'application/json',
        'X-BSTACK-TESTOPS': 'true'
      }
    };
  }

  getAccessibilityOptions() {
    if (helper.isUndefined(this._settings.accessibilityOptions)) {
      return {};
    }

    return {'settings': this._settings.accessibilityOptions};
  }

  setCredentials(settings) {
    if (this._settings.accessibility || this._bstackOptions) {
      this._user = helper.getUserName(settings, this._settings);
      this._key = helper.getAccessKey(settings, this._settings);
    }
    if (this._settings.test_observability || this._bstackOptions) {
      const _user = helper.getObservabilityUser(this._settings.test_observability, this._bstackOptions);
      const _key = helper.getObservabilityKey(this._settings.test_observability, this._bstackOptions);
      if (!_user || !_key) {
        Logger.error('Could not start Test Observability : Missing authentication token');
        process.env.BROWSERSTACK_TEST_OBSERVABILITY = 'false';

        return;
      }
      this._user = _user;
      this._key = _key;
      CrashReporter.setCredentialsForCrashReportUpload(this._user, this._key);
      CrashReporter.setConfigDetails(settings);
    }
  }

  extractDataFromResponse(response, requestData) {
    const launchData = {};
    if (helper.isTestObservabilitySession()) {
      const [jwt, buildHashedId, allowScreenshot] = testHubUtils.setTestObservabilityVariables(response.data);
      if (jwt && buildHashedId) {
        launchData['observability'] =  {jwt, buildHashedId, allowScreenshot};
        process.env.BROWSERSTACK_TEST_OBSERVABILITY = 'true';
      } else {
        launchData['observability'] = {};
        process.env.BROWSERSTACK_TEST_OBSERVABILITY = 'false';
      }
    } else {
      process.env.BROWSERSTACK_TEST_OBSERVABILITY = 'false';
    }
    if (helper.isAccessibilitySession()) {
      const [authToken, buildHashedId] = testHubUtils.setAccessibilityVariables(response.data, requestData);
      if (authToken && buildHashedId) {
        launchData['accessibility'] = {authToken, buildHashedId};
        process.env.BROWSERSTACK_ACCESSIBILITY = 'true';
      } else {
        launchData['accessibility'] = {};
        process.env.BROWSERSTACK_ACCESSIBILITY = 'false';
      }
    } else {
      process.env.BROWSERSTACK_ACCESSIBILITY = 'false';
    }

    if (testHubUtils.shouldProcessEventForTestHub()) {
      testHubUtils.setTestHubCommonMetaInfo(response.data);
    }

    return launchData;
  }

  async stopTestHub() {
    if (testHubUtils.shouldProcessEventForTestHub()) {
      if (process.env.BROWSERSTACK_RERUN === 'true' && process.env.BROWSERSTACK_RERUN_TESTS) {
        await helper.deleteRerunFile();
      }
      try {
        await this.stopBuildUpstream();
        if (process.env.BS_TESTOPS_BUILD_HASHED_ID) {
          Logger.info(`\nVisit https://observability.browserstack.com/builds/${process.env.BS_TESTOPS_BUILD_HASHED_ID} to view build report, insights, and many more debugging information all at one place!\n`);
        }
      } catch (error) {
        Logger.error(`Something went wrong in stopping build session for test observability - ${error}`);
      }
    }
  }

  async stopBuildUpstream () {
    if (!process.env.BROWSERSTACK_TESTHUB_JWT || !process.env.BROWSERSTACK_TESTHUB_UUID) {
      Logger.info('[STOP_BUILD] Missing Authentication Token/ Build ID');

      return {
        status: 'error',
        message: 'Token/buildID is undefined, build creation might have failed'
      };
    }
    const data = {
      'finished_at': new Date().toISOString()
    };
    const config = {
      headers: {
        'Authorization': `Bearer ${process.env.BROWSERSTACK_TESTHUB_JWT}`,
        'Content-Type': 'application/json',
        'X-BSTACK-TESTOPS': 'true'
      }
    };
    await helper.uploadPending();
    await helper.shutDownRequestHandler();
    try {
      const response = await makeRequest('PUT', `api/v1/builds/${process.env.BROWSERSTACK_TESTHUB_UUID}/stop`, data, config, constants.API_URL, false);
      if (response.data?.error) {
        throw {message: response.data.error};
      } else {
        return {
          status: 'success',
          message: ''
        };
      }
    } catch (error) {
      if (error.response) {
        Logger.error(`Exception in stopBuildUpstream request to TestHub : ${error.response.status} ${error.response.statusText} ${JSON.stringify(error.response.data)}`);
      } else {
        Logger.error(`Exception in stopBuildUpstream request to TestHub : ${error.message || error}`);
      }

      return {
        status: 'error',
        message: error
      };
    }
  }
}

module.exports = TestHubHandler;
