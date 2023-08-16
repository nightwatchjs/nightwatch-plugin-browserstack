const os = require('os');
const path = require('path');
const fs = require('fs');
const stripAnsi = require('strip-ansi');
const {v4: uuidv4} = require('uuid');
const helper = require('./utils/helper');
const {makeRequest} = require('./utils/requestHelper');
const CrashReporter = require('./utils/crashReporter');
const Logger = require('./utils/logger');

class TestObservability {
  configure(settings = {}) {
    this._settings = settings['@nightwatch/browserstack'] || {};

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
    
    if (this._settings.test_observability || this._bstackOptions) {
      this._user = helper.getObservabilityUser(this._settings.test_observability, this._bstackOptions);
      this._key = helper.getObservabilityKey(this._settings.test_observability, this._bstackOptions);
      CrashReporter.setCredentialsForCrashReportUpload(this._user, this._key);
      CrashReporter.setConfigDetails(settings);
    }
  }

  async launchTestSession() {
    const options = this._settings.test_observability || {};
    this._gitMetadata = await helper.getGitMetaData();
    const data = {
      format: 'json',
      project_name: helper.getObservabilityProject(this._settings, this._bstackOptions),
      name: helper.getObservabilityBuild(this._settings, this._bstackOptions),
      build_identifier: options.buildIdentifier,
      description: options.buildDescription || '',
      start_time: new Date().toISOString(),
      tags: helper.getObservabilityBuildTags(this._settings, this._bstackOptions),
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
      version_control: this._gitMetadata,
      observability_version: {
        frameworkName: helper.getFrameworkName(this._testRunner),
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
      const response = await makeRequest('POST', 'api/v1/builds', data, config);
      Logger.info('Build creation successfull!');
      process.env.BS_TESTOPS_BUILD_COMPLETED = true;

      const responseData = response.data || {};
      if (responseData.jwt) {
        process.env.BS_TESTOPS_JWT = responseData.jwt;
      }
      if (responseData.build_hashed_id) {
        process.env.BS_TESTOPS_BUILD_HASHED_ID = responseData.build_hashed_id;
      }
      if (responseData.allow_screenshots) {
        process.env.BS_TESTOPS_ALLOW_SCREENSHOTS = responseData.allow_screenshots.toString();
      }
    } catch (error) {
      if (error.response) {
        Logger.error(`EXCEPTION IN BUILD START EVENT : ${error.response.status} ${error.response.statusText} ${JSON.stringify(error.response.data)}`);
      } else {
        Logger.error(`EXCEPTION IN BUILD START EVENT : ${error.message || error}`);
      }
      process.env.BS_TESTOPS_BUILD_COMPLETED = false;
      process.env.BROWSERSTACK_TEST_OBSERVABILITY = false;
    }
  }

  async stopBuildUpstream () {
    if (!process.env.BS_TESTOPS_BUILD_COMPLETED) {
      return;
    }
    if (!process.env.BS_TESTOPS_JWT) {
      Logger.info('[STOP_BUILD] Missing Authentication Token/ Build ID');

      return {
        status: 'error',
        message: 'Token/buildID is undefined, build creation might have failed'
      };
    }
    const data = {
      'stop_time': new Date().toISOString()
    };
    const config = {
      headers: {
        'Authorization': `Bearer ${process.env.BS_TESTOPS_JWT}`,
        'Content-Type': 'application/json',
        'X-BSTACK-TESTOPS': 'true'
      }
    };
    await helper.uploadPending();
    await helper.shutDownRequestHandler();
    try {
      const response = await makeRequest('PUT', `api/v1/builds/${process.env.BS_TESTOPS_BUILD_HASHED_ID}/stop`, data, config);
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
        Logger.error(`EXCEPTION IN stopBuildUpstream REQUEST TO TEST OBSERVABILITY : ${error.response.status} ${error.response.statusText} ${JSON.stringify(error.response.data)}`);
      } else {
        Logger.error(`EXCEPTION IN stopBuildUpstream REQUEST TO TEST OBSERVABILITY : ${error.message || error}`);
      }

      return {
        status: 'error',
        message: error
      };
    }
  }

  async sendEvents(eventData, testFileReport, startEventType, finishedEventType, hookId, hookType, sectionName) {
    await this.sendTestRunEvent(eventData, testFileReport, startEventType, hookId, hookType, sectionName);
    if (eventData.httpOutput && eventData.httpOutput.length > 0) {
      for (const [index, output] of eventData.httpOutput.entries()) {
        if (index % 2 === 0) {
          await this.createHttpLogEvent(output, eventData.httpOutput[index + 1], hookId);
        }
      }
    }
    await this.sendTestRunEvent(eventData, testFileReport, finishedEventType, hookId, hookType, sectionName);
  }

  async processTestReportFile(testFileReport) {
    const completedSections = testFileReport['completedSections'];
    const skippedTests = testFileReport['skippedAtRuntime'].concat(testFileReport['skippedByUser']);
    if (completedSections) {
      const globalBeforeEachHookId = uuidv4();
      const beforeHookId = uuidv4();
      const afterHookId = uuidv4();
      const globalAfterEachHookId = uuidv4();
      const hookIds = [];
      for (const sectionName in completedSections) {
        const eventData = completedSections[sectionName];
        switch (sectionName) {
          case '__global_beforeEach_hook': {
            await this.sendEvents(eventData, testFileReport, 'HookRunStarted', 'HookRunFinished', globalBeforeEachHookId, 'GLOBAL_BEFORE_EACH', sectionName);
            break;
          }
          case '__before_hook': {
            await this.sendEvents(eventData, testFileReport, 'HookRunStarted', 'HookRunFinished', beforeHookId, 'BEFORE_ALL', sectionName);
            break;
          }
          case '__after_hook': {
            await this.sendEvents(eventData, testFileReport, 'HookRunStarted', 'HookRunFinished', afterHookId, 'AFTER_ALL', sectionName);
            break;
          }
          case '__global_afterEach_hook': {
            await this.sendEvents(eventData, testFileReport, 'HookRunStarted', 'HookRunFinished', globalAfterEachHookId, 'GLOBAL_AFTER_EACH', sectionName);
            break;
          }
          default: {
            if (eventData.retryTestData?.length>0) {
              for (const retryTest of eventData.retryTestData) {
                await this.processTestRunData(retryTest, sectionName, testFileReport, hookIds);
              }
            }
            await this.processTestRunData(eventData, sectionName, testFileReport, hookIds);
            break;
          }
        }
      }
      if (skippedTests?.length > 0) {
        for (const skippedTest of skippedTests) {
          await this.sendSkippedTestEvent(skippedTest, testFileReport);
        }
      }
    }
  }

  async processTestRunData (eventData, sectionName, testFileReport, hookIds) {
    const testUuid = uuidv4();
    const errorData = eventData.commands.find(command => command.result?.stack);
    eventData.lastError = errorData ? errorData.result : null;
    await this.sendTestRunEvent(eventData, testFileReport, 'TestRunStarted', testUuid, null, sectionName, hookIds);
    if (eventData.httpOutput && eventData.httpOutput.length > 0) {
      for (const [index, output] of eventData.httpOutput.entries()) {
        if (index % 2 === 0) {
          await this.createHttpLogEvent(output, eventData.httpOutput[index + 1], testUuid);
        }
      }
    }
    if (process.env.BS_TESTOPS_ALLOW_SCREENSHOTS === 'true') {
      for (const command of eventData.commands) {
        if (command.name === 'saveScreenshot' && command.args) {
          await this.createScreenshotLogEvent(testUuid, command.args[0], command.startTime);
        }
      }
    }
    await this.sendTestRunEvent(eventData, testFileReport, 'TestRunFinished', testUuid, null, sectionName, hookIds);
  }

  async sendSkippedTestEvent(skippedTest, testFileReport) {
    const testData = {
      uuid: uuidv4(),
      type: 'test',
      name: skippedTest,
      scope: `${testFileReport.name} - ${skippedTest}`,
      scopes: [
        testFileReport.name
      ],
      tags: testFileReport.tags,
      identifier: `${testFileReport.name} - ${skippedTest}`,
      file_name: path.relative(process.cwd(), testFileReport.modulePath),
      location: path.relative(process.cwd(), testFileReport.modulePath),
      vc_filepath: (this._gitMetadata && this._gitMetadata.root) ? path.relative(this._gitMetadata.root, testFileReport.modulePath) : null,
      started_at: new Date(testFileReport.endTimestamp).toISOString(),
      finished_at: new Date(testFileReport.endTimestamp).toISOString(),
      duration_in_ms: 0,
      result: 'skipped',
      framework: 'nightwatch'
    };
    testData.integrations = {};
    const provider = helper.getCloudProvider(testFileReport.host);
    testData.integrations[provider] = helper.getIntegrationsObject(testFileReport.sessionCapabilities, testFileReport.sessionId);
    const uploadData = {
      event_type: 'TestRunFinished'
    };
    uploadData['test_run'] = testData;
    await helper.uploadEventData(uploadData);
  }

  async createScreenshotLogEvent(testUuid, screenshot, timestamp) {
    if (!fs.existsSync(screenshot)) {
      return;
    }
    const eventData = {
      event_type: 'LogCreated',
      logs: [
        {
          test_run_uuid: testUuid,
          kind: 'TEST_SCREENSHOT',
          timestamp: new Date(timestamp).toISOString(),
          message: fs.readFileSync(screenshot, 'base64')
        }
      ]
    };
    await helper.uploadEventData(eventData);
  }

  async createHttpLogEvent(httpRequest, httpResponse, test_run_uuid) {
    if (httpRequest && httpRequest[1].match(/Request/) && httpResponse && httpResponse[1].match(/Response/)) {
      const eventData = {
        event_type: 'LogCreated',
        logs: [
          {
            test_run_uuid: test_run_uuid,
            timestamp: httpResponse[0],
            kind: 'HTTP',
            http_response: {
              path: stripAnsi(httpRequest[1] || '').replace(/&#39;/g, '\'').trim().split(' ')[2],
              method: stripAnsi(httpRequest[1] || '').replace(/&#39;/g, '\'').trim().split(' ')[1],
              body: stripAnsi(httpRequest[2] || '').replace(/&#39;/g, '\''),
              status_code: stripAnsi(httpResponse[1] || '').replace(/&#39;/g, '\'').trim().split(' ')[1],
              duration_ms: new Date(httpResponse[0]).getTime() - new Date(httpRequest[0]).getTime(),
              response: stripAnsi(httpResponse[2] || '').replace(/&#39;/g, '\'')
            }
          }
        ]
      };
      await helper.uploadEventData(eventData);
    }
  }

  async sendTestRunEvent(eventData, testFileReport, eventType, uuid, hookType, sectionName, hooks) {
    const testData = {
      uuid: uuid,
      type: 'hook',
      name: sectionName,
      scope: `${testFileReport.name} - ${sectionName}`,
      scopes: [
        testFileReport.name
      ],
      tags: testFileReport.tags,
      identifier: `${testFileReport.name} - ${sectionName}`,
      file_name: path.relative(process.cwd(), testFileReport.modulePath),
      location: path.relative(process.cwd(), testFileReport.modulePath),
      vc_filepath: (this._gitMetadata && this._gitMetadata.root) ? path.relative(this._gitMetadata.root, testFileReport.modulePath) : null,
      started_at: new Date(eventData.startTimestamp).toISOString(),
      result: 'pending',
      framework: 'nightwatch',
      hook_type: hookType
    };

    if (eventType === 'HookRunFinished' || eventType === 'TestRunFinished') {
      testData.finished_at = eventData.endTimestamp ? new Date(eventData.endTimestamp).toISOString() : new Date(eventData.startTimestamp).toISOString();
      testData.result = eventData.status === 'pass' ? 'passed' : 'failed';
      testData.duration_in_ms = 'timeMs' in eventData ? eventData.timeMs : eventData.time;
      if (eventData.status === 'fail' && eventData.lastError) {
        testData.failure = [
          {
            'backtrace': [eventData.lastError.stack]
          }
        ];
        testData.failure_reason = eventData.lastError ? stripAnsi(eventData.lastError.message) : null;
        if (eventData.lastError && eventData.lastError.name) {
          testData.failure_type = eventData.lastError.name.match(/Assert/) ? 'AssertionError' : 'UnhandledError';
        }
      } else if (eventData.status === 'fail' && testFileReport?.completed[sectionName]?.lastError) {
        const testCompletionData = testFileReport.completed[sectionName];
        testData.failure = [
          {'backtrace': [testCompletionData?.stackTrace]}
        ];
        testData.failure_reason = testCompletionData?.assertions.find(val => val.stackTrace === testCompletionData.stackTrace)?.failure;
        testData.failure_type = testCompletionData?.stackTrace.match(/Assert/) ? 'AssertionError' : 'UnhandledError';
      }
    }

    if (eventType === 'HookRunStarted') {
      testData.integrations = {};
      const provider = helper.getCloudProvider(testFileReport.host);
      testData.integrations[provider] = helper.getIntegrationsObject(testFileReport.sessionCapabilities, testFileReport.sessionId);
    }
    
    if (eventType === 'TestRunStarted') {
      testData.type = 'test';
      testData.integrations = {};
      const provider = helper.getCloudProvider(testFileReport.host);
      testData.integrations[provider] = helper.getIntegrationsObject(testFileReport.sessionCapabilities, testFileReport.sessionId);
    }

    if (eventType === 'TestRunFinished') {
      testData.type = 'test';
      testData.hooks = hooks;
    }

    const uploadData = {
      event_type: eventType
    };
    if (eventType.match(/HookRun/)) {
      uploadData['hook_run'] = testData;
    } else {
      uploadData['test_run'] = testData;
    }
    await helper.uploadEventData(uploadData);
  }
}

module.exports = TestObservability;
