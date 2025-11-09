const helper = require('./helper');
const {makeRequest} = require('./requestHelper');
const Logger = require('./logger');
const {API_URL} = require('./constants');

class CrashReporter {

  static setCredentialsForCrashReportUpload(username, key) {
    this.credentialsForCrashReportUpload = {
      username: username,
      password: key
    };
  }

  static filterPII(settings) {
    const keysToDelete = ['user', 'username', 'userName', 'key', 'accessKey'];
    const configWithoutPII = JSON.parse(JSON.stringify(settings));
    const deleteKeys = (obj) => {
      if (!obj) {
        return;
      }
      keysToDelete.forEach(key => delete obj[key]);
    };
    if (configWithoutPII['@nightwatch/browserstack'] && configWithoutPII['@nightwatch/browserstack'].test_observability) {
      deleteKeys(configWithoutPII['@nightwatch/browserstack'].test_observability);
    }
    if (configWithoutPII.desiredCapabilities && configWithoutPII.desiredCapabilities['bstack:options']) {
      deleteKeys(configWithoutPII.desiredCapabilities['bstack:options']);
    }
    
    return configWithoutPII;
  }

  static setConfigDetails(settings={}) {
    const configWithoutPII = this.filterPII(settings);

    this.userConfigForReporting = {
      framework: 'nightwatch-default',
      services: configWithoutPII,
      capabilities: configWithoutPII.desiredCapabilities
    };
  }

  static async uploadCrashReport(exception, stackTrace) {
    const config = {
      auth: this.credentialsForCrashReportUpload || {},
      headers: {
        'Content-Type': 'application/json',
        'X-BSTACK-TESTOPS': 'true'
      }
    };

    try {
      const data = {
        hashed_id: process.env.BROWSERSTACK_TESTHUB_UUID,
        observability_version: {
          frameworkName: 'nightwatch-default',
          frameworkVersion: helper.getPackageVersion('nightwatch'),
          sdkVersion: helper.getAgentVersion()
        },
        exception: {
          error: exception.toString(),
          stackTrace: stackTrace
        },
        config: this.userConfigForReporting || {}
      };
      await makeRequest('POST', 'api/v1/analytics', data, config, API_URL, false);
    } catch (error) {
      Logger.error(`[Crash_Report_Upload] Failed due to ${error}`);
    }
  }
}

module.exports = CrashReporter;
