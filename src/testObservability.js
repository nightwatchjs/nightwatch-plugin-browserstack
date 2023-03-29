const os = require('os');
const helper = require('../src/utils/helper');

class TestObservability {
  configure(settings = {}) {
    this._settings = settings['@nightwatch/browserstack'] || {};
    
    this._user = helper.getObservabilityUser(this._settings);
    this._key = helper.getObservabilityKey(this._settings);
  }

  async launchTestSession() {
    const options = this._settings.testObservabilityOptions || {};
    const data = {
      format: 'json',
      project_name: helper.getObservabilityProject(this._settings),
      name: helper.getObservabilityBuild(this._settings),
      build_identifier: options.buildIdentifier,
      description: options.buildDescription || '',
      start_time: (new Date()).toISOString(),
      tags: helper.getObservabilityBuildTags(this._settings),
      host_info: {
        hostname: os.hostname(),
        platform: os.platform(),
        type: os.type(),
        version: os.version(),
        arch: os.arch()
      },
      ci_info: helper.getCiInfo(),
      build_run_identifier: process.env.BROWSERSTACK_BUILD_RUN_IDENTIFIER,
      failed_tests_rerun: process.env.BROWSERSTACK_RERUN || false,
      version_control: await helper.getGitMetaData(),
      observability_version: {
        frameworkName: 'nightwatch',
        frameworkVersion: helper.getPackageVersion('nightwatch'),
        sdkVersion: helper.getAgentVersion()
      }
    };

    const config = {
      auth: {
        username: this._user,
        password: this._key
      },
      headers: {
        'Content-Type': 'application/json',
        'X-BSTACK-TESTOPS': 'true'
      }
    };

    try {
      const response = await helper.nodeRequest('POST', 'api/v1/builds', data, config);
      console.log('Build creation successfull!');
      process.env.BS_TESTOPS_BUILD_COMPLETED = true;

      if (response.data && response.data.jwt) {
        process.env.BS_TESTOPS_JWT = response.data.jwt;
      }
      if (response.data && response.data.build_hashed_id) {
        process.env.BS_TESTOPS_BUILD_HASHED_ID = response.data.build_hashed_id;
      }
      if (response.data && response.data.allow_screenshots) {
        process.env.BS_TESTOPS_ALLOW_SCREENSHOTS = response.data.allow_screenshots.toString();
      }
    } catch (error) {
      if (error.response) {
        console.log(`EXCEPTION IN BUILD START EVENT : ${error.response.status} ${error.response.statusText} ${JSON.stringify(error.response.data)}`);
      } else {
        if ((error.message && error.message.includes('with status : 401')) || (error && error.toString().includes('with status : 401'))) {
          console.log('Either your BrowserStack access credentials are incorrect or you do not have access to BrowserStack Test Observability yet.');
        } else {
          console.log(`EXCEPTION IN BUILD START EVENT : ${error.message || error}`);
        }
      }
      process.env.BS_TESTOPS_BUILD_COMPLETED = false;

    }
  }
}

module.exports = TestObservability;
