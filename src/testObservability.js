const os = require('os');
const path = require('path');
const fs = require('fs');
const stripAnsi = require('strip-ansi');
const {v4: uuidv4} = require('uuid');
const helper = require('./utils/helper');

class TestObservability {
  configure(settings = {}) {
    this._settings = settings['@nightwatch/browserstack'] || {};
    this._testRunner = settings.test_runner;
    this._bstackOptions = {};
    if (settings && settings.desiredCapabilities && settings.desiredCapabilities['bstack:options']) {
      this._bstackOptions = settings.desiredCapabilities['bstack:options'];
    }
    
    if (this._settings.testObservabilityOptions || this._bstackOptions) {
      this._user = helper.getObservabilityUser(this._settings.testObservabilityOptions, this._bstackOptions);
      this._key = helper.getObservabilityKey(this._settings.testObservabilityOptions, this._bstackOptions);
    }
    if (this._settings.testObservability) {
      process.env.BROWSERSTACK_TEST_OBSERVABILITY = this._settings.testObservability;
    }
    if (process.argv.includes('--disable-test-observability')) {
      process.env.BROWSERSTACK_TEST_OBSERVABILITY = false;
    }
  }

  async launchTestSession() {
    const options = this._settings.testObservabilityOptions || {};
    this._gitMetadata = await helper.getGitMetaData();
    const data = {
      format: 'json',
      project_name: helper.getObservabilityProject(this._settings, this._bstackOptions),
      name: helper.getObservabilityBuild(this._settings, this._bstackOptions),
      build_identifier: options.buildIdentifier,
      description: options.buildDescription || '',
      start_time: (new Date()).toISOString(),
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
      const response = await helper.makeRequest('POST', 'api/v1/builds', data, config);
      console.log('nightwatch-browserstack-plugin: Build creation successfull!');
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
        console.log(`nightwatch-browserstack-plugin: EXCEPTION IN BUILD START EVENT : ${error.response.status} ${error.response.statusText} ${JSON.stringify(error.response.data)}`);
      } else {
        if ((error.message && error.message.includes('with status : 401')) || (error && error.toString().includes('with status : 401'))) {
          console.log('nightwatch-browserstack-plugin: Either your BrowserStack access credentials are incorrect or you do not have access to BrowserStack Test Observability yet.');
        } else {
          console.log(`nightwatch-browserstack-plugin: EXCEPTION IN BUILD START EVENT : ${error.message || error}`);
        }
      }
      process.env.BS_TESTOPS_BUILD_COMPLETED = false;

    }
  }

  async stopBuildUpstream () {
    if (!process.env.BS_TESTOPS_BUILD_COMPLETED) {
      return;
    }
    if (!process.env.BS_TESTOPS_JWT) {
      console.log('nightwatch-browserstack-plugin: [STOP_BUILD] Missing Authentication Token/ Build ID');

      return {
        status: 'error',
        message: 'Token/buildID is undefined, build creation might have failed'
      };
    }
    const data = {
      'stop_time': (new Date()).toISOString()
    };
    const config = {
      headers: {
        'Authorization': `Bearer ${process.env.BS_TESTOPS_JWT}`,
        'Content-Type': 'application/json',
        'X-BSTACK-TESTOPS': 'true'
      }
    };
    helper.requestQueueHandler.shutdown();
    try {
      const response = await helper.makeRequest('PUT', `api/v1/builds/${process.env.BS_TESTOPS_BUILD_HASHED_ID}/stop`, data, config);
      if (response.data && response.data.error) {
        throw ({message: response.data.error});
      } else {
        return {
          status: 'success',
          message: ''
        };
      }
    } catch (error) {
      if (error.response) {
        console.log(`nightwatch-browserstack-plugin: EXCEPTION IN stopBuildUpstream REQUEST TO TEST OBSERVABILITY : ${error.response.status} ${error.response.statusText} ${JSON.stringify(error.response.data)}`);
      } else {
        console.log(`nightwatch-browserstack-plugin: EXCEPTION IN stopBuildUpstream REQUEST TO TEST OBSERVABILITY : ${error.message || error}`);
      }

      return {
        status: 'error',
        message: error.message || error.response ? `${error.response.status}:${error.response.statusText}` : error
      };
    }
  }

  async processTestFile(testFileReport) {
    const completedSections = testFileReport['completedSections'];
    const completed = testFileReport['completed'];
    if (completedSections) {
      const globalBeforeEachHookId = uuidv4();
      const beforeHookId = uuidv4();
      const afterHookId = uuidv4();
      const globalAfterEachHookId = uuidv4();
      const hookIds = [];
      for (const sectionName in completedSections) {
        const eventData = completedSections[sectionName];
        if (sectionName === '__global_beforeEach_hook') {
          await this.sendTestRunEvent(eventData, testFileReport, 'HookRunStarted', globalBeforeEachHookId, 'GLOBAL_BEFORE_EACH');
          if (eventData.httpOutput && eventData.httpOutput.length > 0) {
            for (let i=0; i<eventData.httpOutput.length; i+=2) {
              await this.createHttpLogEvent(eventData.httpOutput[i], eventData.httpOutput[i+1], globalBeforeEachHookId);
            }
          }
          await this.sendTestRunEvent(eventData, testFileReport, 'HookRunFinished', globalBeforeEachHookId, 'GLOBAL_BEFORE_EACH');
        } else if (sectionName === '__before_hook') {
          await this.sendTestRunEvent(eventData, testFileReport, 'HookRunStarted', beforeHookId, 'BEFORE_ALL');
          if (eventData.httpOutput && eventData.httpOutput.length > 0) {
            for (let i=0; i<eventData.httpOutput.length; i+=2) {
              await this.createHttpLogEvent(eventData.httpOutput[i], eventData.httpOutput[i+1], beforeHookId);
            }
          }
          await this.sendTestRunEvent(eventData, testFileReport, 'HookRunFinished', beforeHookId, 'BEFORE_ALL');
        } else if (sectionName === '__after_hook') {
          await this.sendTestRunEvent(eventData, testFileReport, 'HookRunStarted', afterHookId, 'AFTER_ALL');
          if (eventData.httpOutput && eventData.httpOutput.length > 0) {
            for (let i=0; i<eventData.httpOutput.length; i+=2) {
              await this.createHttpLogEvent(eventData.httpOutput[i], eventData.httpOutput[i+1], afterHookId);
            }
          }
          await this.sendTestRunEvent(eventData, testFileReport, 'HookRunFinished', afterHookId, 'AFTER_ALL');
        } else if (sectionName === '__global_afterEach_hook') {
          await this.sendTestRunEvent(eventData, testFileReport, 'HookRunStarted', globalAfterEachHookId, 'GLOBAL_AFTER_EACH');
          if (eventData.httpOutput && eventData.httpOutput.length > 0) {
            for (let i=0; i<eventData.httpOutput.length; i+=2) {
              await this.createHttpLogEvent(eventData.httpOutput[i], eventData.httpOutput[i+1], globalAfterEachHookId);
            }
          }
          await this.sendTestRunEvent(eventData, testFileReport, 'HookRunFinished', globalAfterEachHookId, 'GLOBAL_AFTER_EACH');
        } else {
          const testUuid = uuidv4();
          const completedEventData = completed[sectionName];
          eventData.timeMs = completedEventData.timeMs;
          eventData.startTimestamp = completedEventData.startTimestamp;
          eventData.endTimestamp = completedEventData.endTimestamp;
          eventData.stackTrace = completedEventData.stackTrace;
          eventData.lastError = completedEventData.lastError;
          await this.sendTestRunEvent(eventData, testFileReport, 'TestRunStarted', testUuid, null, sectionName, hookIds);
          if (eventData.httpOutput && eventData.httpOutput.length > 0) {
            for (let i=0; i<eventData.httpOutput.length; i+=2) {
              await this.createHttpLogEvent(eventData.httpOutput[i], eventData.httpOutput[i+1], testUuid);
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
      }
    }
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
      name: eventType,
      scope: `${testFileReport.name} - ${eventType}`,
      scopes: [
        testFileReport.name
      ],
      tags: testFileReport.tags,
      identifier: `${testFileReport.name} - ${eventType}`,
      file_name: testFileReport.modulePath,
      location: testFileReport.modulePath,
      vc_filepath: this._gitMetadata ? path.relative(this._gitMetadata.root, testFileReport.modulePath) : null,
      started_at: new Date(eventData.startTimestamp).toISOString(),
      result: 'pending',
      framework: 'nightwatch',
      hook_type: hookType
    };

    if (eventType === 'HookRunFinished' || eventType === 'TestRunFinished') {
      testData.finished_at = new Date(eventData.endTimestamp).toISOString();
      testData.result = eventData.status === 'pass' ? 'passed' : 'failed';
      testData.duration_in_ms = 'timeMs' in eventData ? eventData.timeMs : eventData.time;
      if (eventData.status === 'fail') {
        testData.failure = [
          {
            'backtrace': [eventData.stackTrace]
          }
        ];
        testData.failure_reason = eventData.lastError ? stripAnsi(eventData.lastError.message) : null;
        if (eventData.lastError && eventData.lastError.name) {
          testData.failure_type = eventData.lastError.name.match(/Assert/) ? 'AssertionError' : 'UnhandledError';
        }
      }
    }

    if (eventType === 'TestRunStarted' || eventType === 'TestRunFinished') {
      testData.type = 'test';
      testData.name = sectionName;
      testData.scope = `${testFileReport.name} - ${sectionName}`;
      testData.identifier = `${testFileReport.name} - ${sectionName}`;
    }

    if (eventType === 'TestRunStarted') {
      testData.integrations = {};
      const provider = helper.getCloudProvider(testFileReport.host);
      testData.integrations[provider] = helper.getIntegrationsObject(testFileReport.sessionCapabilities, testFileReport.sessionId);
    }

    if (eventType === 'TestRunFinished') {
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
