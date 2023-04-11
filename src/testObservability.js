const os = require('os');
const stripAnsi = require('strip-ansi');
const {v4: uuidv4} = require('uuid');
const helper = require('./utils/helper');

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

  async stopBuildUpstream () {
    if (!process.env.BS_TESTOPS_BUILD_COMPLETED) {
      return;
    }
    if (!process.env.BS_TESTOPS_JWT) {
      console.log('[STOP_BUILD] Missing Authentication Token/ Build ID');

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

    try {
      const response = await helper.nodeRequest('PUT', `api/v1/builds/${process.env.BS_TESTOPS_BUILD_HASHED_ID}/stop`, data, config);
      if (response.data.error) {
        throw ({message: response.data.error});
      } else {
        return {
          status: 'success',
          message: ''
        };
      }
    } catch (error) {
      if (error.response) {
        console.log(`EXCEPTION IN stopBuildUpstream REQUEST TO TEST OBSERVABILITY : ${error.response.status} ${error.response.statusText} ${JSON.stringify(error.response.data)}`);
      } else {
        console.log(`EXCEPTION IN stopBuildUpstream REQUEST TO TEST OBSERVABILITY : ${error.message || error}`);
      }

      return {
        status: 'error',
        message: error.message || error.response ? `${error.response.status}:${error.response.statusText}` : error
      };
    }
  }

  processTestFile(testFileReport) {
    const completedSections = testFileReport['completedSections'];
    const completed = testFileReport['completed'];
    if (completedSections) {
      const globalBeforeEachHookId = uuidv4();
      const beforeHookId = uuidv4();
      const afterHookId = uuidv4();
      const globalAfterEachHookId = uuidv4();
      const hookIds = [globalBeforeEachHookId, beforeHookId, afterHookId, globalAfterEachHookId];
      for (const sectionName in completedSections) {
        const eventData = completedSections[sectionName];
        if (sectionName === '__global_beforeEach_hook') {
          this.sendTestRunEvent(eventData, testFileReport, 'HookRunStarted', globalBeforeEachHookId, 'GLOBAL_BEFORE_EACH');
          if (eventData.httpOutput && eventData.httpOutput.length > 0) {
            for (let i=0; i<eventData.httpOutput.length; i+=2) {
              this.createHttpLogEvent(eventData.httpOutput[i], eventData.httpOutput[i+1], globalBeforeEachHookId);
            }
          }
          this.sendTestRunEvent(eventData, testFileReport, 'HookRunFinished', globalBeforeEachHookId, 'GLOBAL_BEFORE_EACH');
        } else if (sectionName === '__before_hook') {
          this.sendTestRunEvent(eventData, testFileReport, 'HookRunStarted', beforeHookId, 'BEFORE_ALL');
          if (eventData.httpOutput && eventData.httpOutput.length > 0) {
            for (let i=0; i<eventData.httpOutput.length; i+=2) {
              this.createHttpLogEvent(eventData.httpOutput[i], eventData.httpOutput[i+1], beforeHookId);
            }
          }
          this.sendTestRunEvent(eventData, testFileReport, 'HookRunFinished', beforeHookId, 'BEFORE_ALL');
        } else if (sectionName === '__after_hook') {
          this.sendTestRunEvent(eventData, testFileReport, 'HookRunStarted', afterHookId, 'AFTER_ALL');
          if (eventData.httpOutput && eventData.httpOutput.length > 0) {
            for (let i=0; i<eventData.httpOutput.length; i+=2) {
              this.createHttpLogEvent(eventData.httpOutput[i], eventData.httpOutput[i+1], afterHookId);
            }
          }
          this.sendTestRunEvent(eventData, testFileReport, 'HookRunFinished', afterHookId, 'AFTER_ALL');
        } else if (sectionName === '__global_afterEach_hook') {
          this.sendTestRunEvent(eventData, testFileReport, 'HookRunStarted', globalAfterEachHookId, 'GLOBAL_AFTER_EACH');
          if (eventData.httpOutput && eventData.httpOutput.length > 0) {
            for (let i=0; i<eventData.httpOutput.length; i+=2) {
              this.createHttpLogEvent(eventData.httpOutput[i], eventData.httpOutput[i+1], globalAfterEachHookId);
            }
          }
          this.sendTestRunEvent(eventData, testFileReport, 'HookRunFinished', globalAfterEachHookId, 'GLOBAL_AFTER_EACH');
        } else {
          const testUuid = uuidv4();
          const completedEventData = completed[sectionName];
          eventData.timeMs = completedEventData.timeMs;
          eventData.startTimestamp = completedEventData.startTimestamp;
          eventData.endTimestamp = completedEventData.endTimestamp;
          eventData.lastError = completedEventData.lastError;
          this.sendTestRunEvent(eventData, testFileReport, 'TestRunStarted', testUuid, null, sectionName, hookIds);
          if (eventData.httpOutput && eventData.httpOutput.length > 0) {
            for (let i=0; i<eventData.httpOutput.length; i+=2) {
              this.createHttpLogEvent(eventData.httpOutput[i], eventData.httpOutput[i+1], testUuid);
            }
          }
          if (eventData.status === 'fail') {
            eventData.commands.filter(command => {
              return 'screenshot' in command;
            }).forEach(command => {
              this.createScreenshotLogEvent(testUuid, command.screenshot, command.startTime);
            });
          }
          this.sendTestRunEvent(eventData, testFileReport, 'TestRunFinished', testUuid, null, sectionName, hookIds);
        }
      }
    }
  }

  createScreenshotLogEvent(testUuid, screenshot, timestamp) {
    const eventData = {
      event_type: 'LogCreated',
      logs: [
        {
          test_run_uuid: testUuid,
          kind: 'TEST_SCREENSHOT',
          timestamp: new Date(timestamp).toISOString(),
          message: screenshot
        }
      ]
    };
    helper.uploadEventData(eventData);
  }

  createHttpLogEvent(httpRequest, httpResponse, test_run_uuid) {
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
            response: stripAnsi(httpResponse[2] || '').replace(/&#39;/g, '\'')
          }
        }
      ]
    };
    helper.uploadEventData(eventData);
  }

  sendTestRunEvent(eventData, testFileReport, eventType, uuid, hookType, sectionName, hooks) {
    const testData = {
      uuid: uuid,
      type: 'hook',
      name: eventType,
      scope: `${testFileReport.name} - ${eventType}`,
      scopes: [
        testFileReport.name
      ],
      identifier: `${testFileReport.name} - ${eventType}`,
      file_name: testFileReport.modulePath,
      location: testFileReport.modulePath,
      vc_filepath: helper.vcFilePath(process.cwd()),
      started_at: new Date(eventData.startTimestamp).toISOString(),
      result: 'pending',
      framework: 'nightwatch',
      hook_type: hookType
    };

    if (eventType === 'HookRunFinished' || eventType === 'TestRunFinished') {
      testData.finished_at = new Date(eventData.endTimestamp).toISOString();
      testData.result = eventData.status === 'pass' ? 'passed' : 'failed';
      testData.duration_in_ms = 'timeMs' in eventData ? eventData.timeMs : eventData.time;
      if (eventData.status === 'fail' && eventData.lastError) {
        testData.failure = [
          {
            'backtrace': [eventData.lastError.stack]
          }
        ];
        testData.failure_reason = stripAnsi(eventData.lastError.message);
        testData.failure_type = eventData.lastError.name.match(/Assert/) ? 'AssertionError' : 'UnhandledError';
      }
    }

    if (eventType === 'TestRunStarted' || eventType === 'TestRunFinished') {
      testData.type = 'test';
      testData.name = sectionName;
      testData.scope = `${testFileReport.name} - ${sectionName}`;
      testData.identifier = `${testFileReport.name} - ${sectionName}`;
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
    helper.uploadEventData(uploadData);
  }
}

module.exports = TestObservability;
