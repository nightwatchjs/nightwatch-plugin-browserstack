const os = require('os');
const path = require('path');
const fs = require('fs');
const stripAnsi = require('strip-ansi');
const {v4: uuidv4} = require('uuid');
const helper = require('./utils/helper');
const {makeRequest} = require('./utils/requestHelper');
const CrashReporter = require('./utils/crashReporter');
const Logger = require('./utils/logger');
const {API_URL, TAKE_SCREENSHOT_REGEX} = require('./utils/constants');
const OrchestrationUtils = require('./testorchestration/orchestrationUtils')
const hooksMap = {};

class TestObservability {
  configure(settings = {}) {
    this._settings = settings['@nightwatch/browserstack'] || {};
    this._parentSettings = settings; // Store full settings to access top-level options

    // Initialize environment variables only if they're not already set
    if (!process.env.BROWSERSTACK_TEST_OBSERVABILITY && !process.env.BROWSERSTACK_TEST_REPORTING) {
      process.env.BROWSERSTACK_TEST_OBSERVABILITY = 'true';
      process.env.BROWSERSTACK_TEST_REPORTING = 'true';
    }

    // Check for top-level testObservability or testReporting flags
    if (settings.testObservability === true || settings.testReporting === true) {
      process.env.BROWSERSTACK_TEST_OBSERVABILITY = 'true';
      process.env.BROWSERSTACK_TEST_REPORTING = 'true';
    } else if (settings.testObservability === false || settings.testReporting === false) {
      process.env.BROWSERSTACK_TEST_OBSERVABILITY = 'false';
      process.env.BROWSERSTACK_TEST_REPORTING = 'false';
    }

    // Check for test_observability or test_reporting configuration  
    const observabilityConfig = this._settings.test_observability || this._settings.test_reporting;
    const testReportingOptions = this._settings.testReportingOptions || this._settings.testObservabilityOptions;
    
    if (!helper.isUndefined(observabilityConfig) && !helper.isUndefined(observabilityConfig.enabled)) {
      process.env.BROWSERSTACK_TEST_OBSERVABILITY = observabilityConfig.enabled;
      process.env.BROWSERSTACK_TEST_REPORTING = observabilityConfig.enabled;
    }
    
    if (process.argv.includes('--disable-test-observability') || process.argv.includes('--disable-test-reporting')) {
      process.env.BROWSERSTACK_TEST_OBSERVABILITY = 'false';
      process.env.BROWSERSTACK_TEST_REPORTING = 'false';

      return;
    }

    this._testRunner = settings.test_runner;
    this._bstackOptions = {};
    if (settings && settings.desiredCapabilities && settings.desiredCapabilities['bstack:options']) {
      this._bstackOptions = settings.desiredCapabilities['bstack:options'];
    }

    if (observabilityConfig || testReportingOptions || this._bstackOptions) {
      this._user = helper.getObservabilityUser(observabilityConfig || testReportingOptions, this._bstackOptions);
      this._key = helper.getObservabilityKey(observabilityConfig || testReportingOptions, this._bstackOptions);
      if (!this._user || !this._key) {
        Logger.error('Could not start Test Reporting and Analytics : Missing authentication token');
        process.env.BROWSERSTACK_TEST_OBSERVABILITY = 'false';
        process.env.BROWSERSTACK_TEST_REPORTING = 'false';

        return;
      }
      CrashReporter.setCredentialsForCrashReportUpload(this._user, this._key);
      CrashReporter.setConfigDetails(settings);
    }
    
    // Also check for top-level testReportingOptions or testObservabilityOptions
    if (settings.testReportingOptions || settings.testObservabilityOptions) {
      const topLevelOptions = settings.testReportingOptions || settings.testObservabilityOptions;
      if (!this._user || !this._key) {
        this._user = helper.getObservabilityUser(topLevelOptions, this._bstackOptions);
        this._key = helper.getObservabilityKey(topLevelOptions, this._bstackOptions);
        if (this._user && this._key) {
          CrashReporter.setCredentialsForCrashReportUpload(this._user, this._key);
          CrashReporter.setConfigDetails(settings);
        }
      }
    }
  }

  async launchTestSession() {
    // Support both old and new configuration options at different levels
    const options = this._settings.test_observability || 
                   this._settings.test_reporting || 
                   this._settings.testReportingOptions || 
                   this._settings.testObservabilityOptions || 
                   this._parentSettings?.testReportingOptions ||
                   this._parentSettings?.testObservabilityOptions ||
                   {};
    this._gitMetadata = await helper.getGitMetaData();
    const fromProduct = {
      test_observability: true,
      test_reporting: true
    };
    const data = {
      format: 'json',
      project_name: helper.getProjectName(this._settings, this._bstackOptions, fromProduct),
      name: helper.getBuildName(this._settings, this._bstackOptions, fromProduct),
      build_identifier: options.buildIdentifier,
      description: options.buildDescription || '',
      start_time: new Date().toISOString(),
      tags: helper.getObservabilityBuildTags(this._settings, this._bstackOptions),
      host_info: helper.getHostInfo(),
      ci_info: helper.getCiInfo(),
      build_run_identifier: process.env.BROWSERSTACK_BUILD_RUN_IDENTIFIER,
      failed_tests_rerun: process.env.BROWSERSTACK_RERUN || false,
      version_control: this._gitMetadata,
      observability_version: {
        frameworkName: helper.getFrameworkName(this._testRunner),
        frameworkVersion: helper.getPackageVersion('nightwatch'),
        sdkVersion: helper.getAgentVersion()
      },
      test_orchestration: this.getTestOrchestrationBuildStartData(this._settings)
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
      const response = await makeRequest('POST', 'api/v1/builds', data, config, API_URL);
      Logger.info('Build creation successful!');
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
      process.env.BROWSERSTACK_TEST_REPORTING = false;
    }
  }
  getTestOrchestrationBuildStartData(settings) {
    const orchestrationUtils = OrchestrationUtils.getInstance(settings); 
    return orchestrationUtils.getBuildStartData();
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
      const response = await makeRequest('PUT', `api/v1/builds/${process.env.BS_TESTOPS_BUILD_HASHED_ID}/stop`, data, config, API_URL, false);
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
        Logger.error(`EXCEPTION IN stopBuildUpstream REQUEST TO TEST REPORTING AND ANALYTICS : ${error.response.status} ${error.response.statusText} ${JSON.stringify(error.response.data)}`);
      } else {
        Logger.error(`EXCEPTION IN stopBuildUpstream REQUEST TO TEST REPORTING AND ANALYTICS : ${error.message || error}`);
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
          // In newer NW versions, command args are stringified
          let screenshotPath;
          try {
            screenshotPath = JSON.parse(command.args[0]);
          } catch {
            screenshotPath = command.args[0];
          }
          try {
            if (fs.existsSync(screenshotPath)) {
              const screenshot = fs.readFileSync(screenshotPath, 'base64');
              await this.createScreenshotLogEvent(testUuid, screenshot, command.startTime);
            }
          } catch (err) {
            Logger.debug(`Failed to upload screenshot from saveScreenshot: ${err.message}`);
          }
        } else if (TAKE_SCREENSHOT_REGEX.test(command.name) && command.result) {
          try {
            if (command.result.value) {
              await this.createScreenshotLogEvent(testUuid, command.result.value, command.startTime);
            } else if (command.result.valuePath) {
              if (fs.existsSync(command.result.valuePath)) {
                const screenshot = fs.readFileSync(command.result.valuePath, 'utf8');
                await this.createScreenshotLogEvent(testUuid, screenshot, command.startTime);
              }
            }
          } catch (err) {
            Logger.debug(`Failed to upload screenshot from takeScreenshot: ${err.message}`);
          }
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
    testData.integrations[provider] = helper.getIntegrationsObject(testFileReport.sessionCapabilities, testFileReport.sessionId, testFileReport.host);
    const uploadData = {
      event_type: 'TestRunFinished'
    };
    uploadData['test_run'] = testData;
    await helper.uploadEventData(uploadData);
  }

  async createScreenshotLogEvent(testUuid, screenshot, timestamp) {
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
            'backtrace': [stripAnsi(eventData.lastError.message), eventData.lastError.stack]
          }
        ];
        testData.failure_reason = eventData.lastError ? stripAnsi(eventData.lastError.message) : null;
        if (eventData.lastError && eventData.lastError.name) {
          testData.failure_type = eventData.lastError.name.match(/Assert/) ? 'AssertionError' : 'UnhandledError';
        }
      } else if (eventData.status === 'fail' && (testFileReport?.completed[sectionName]?.lastError || testFileReport?.completed[sectionName]?.stackTrace)) {
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
      testData.integrations[provider] = helper.getIntegrationsObject(testFileReport.sessionCapabilities, testFileReport.sessionId, testFileReport.host);
    }

    if (eventType === 'TestRunStarted') {
      testData.type = 'test';
      testData.integrations = {};
      const provider = helper.getCloudProvider(testFileReport.host);
      testData.integrations[provider] = helper.getIntegrationsObject(testFileReport.sessionCapabilities, testFileReport.sessionId, testFileReport.host);
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

  async sendTestRunEventForCucumber(reportData, gherkinDocument, pickleData, eventType, testMetaData, args = {}) {
    const {feature, scenario, steps, uuid, startedAt, finishedAt} = testMetaData || {};
    const examples = helper.getScenarioExamples(gherkinDocument, pickleData);
    const fullNameWithExamples = examples
      ? pickleData.name + ' (' + examples.join(', ')  + ')'
      : pickleData.name;
    const testData = {
      uuid: uuid,
      started_at: startedAt,
      finished_at: finishedAt,
      type: 'test',
      body: {
        lang: 'nightwatch',
        code: null
      },
      name: fullNameWithExamples,
      scope: fullNameWithExamples,
      scopes: [feature?.name || ''],
      tags: pickleData.tags?.map(({name}) => (name)),
      identifier: scenario?.name,
      file_name: path.relative(process.cwd(), feature.path),
      location: path.relative(process.cwd(), feature.path),
      vc_filepath: (this._gitMetadata && this._gitMetadata.root) ? path.relative(this._gitMetadata.root, feature.path) : null,
      framework: 'nightwatch',
      result: 'pending',
      meta: {
        feature: feature,
        scenario: scenario,
        steps: steps,
        examples: examples
      }
    };

    try {
      if (eventType === 'TestRunFinished') {
        let currentSessionCapabilities = reportData.session[args.envelope.testCaseStartedId];
        if (currentSessionCapabilities === undefined || currentSessionCapabilities.error) {
          currentSessionCapabilities = helper.generateCapabilityDetails(args);
        }

        const sessionCapabilities = currentSessionCapabilities.capabilities;
        if ((sessionCapabilities) && (args.envelope.testCaseStartedId === currentSessionCapabilities.testCaseStartedId)) {
          testData.integrations = {};
          const provider = helper.getCloudProvider(currentSessionCapabilities.host);
          testData.integrations[provider] = helper.getIntegrationsObject(sessionCapabilities, currentSessionCapabilities.sessionId, currentSessionCapabilities.host);
        } else {
          Logger.debug('Failed to upload integrations data');
        }
      }
    } catch (error) {
      CrashReporter.uploadCrashReport(error.message, error.stack);
    }

    if (reportData.testCaseFinished && steps) {
      const testCaseResult = reportData.testCaseFinished[args.envelope.testCaseStartedId];
      let result = 'passed';
      steps.every((step) => {
        if (step.result === 'FAILED'){
          result = 'failed';
          testCaseResult.failure = step.failure;
          testCaseResult.failureType = step.failureType;

          return false;
        } else if (step.result === 'SKIPPED') {
          result = 'skipped';

          return false;
        }

        return true;
      });

      testData.finished_at = new Date().toISOString();
      testData.result = result;
      testData.duration_in_ms = testCaseResult.timestamp.nanos / 1000000;
      if (result === 'failed') {
        testData.failure = [
          {
            'backtrace': [testCaseResult?.failure ? stripAnsi(testCaseResult?.failure) : 'unknown']
          }
        ],
        testData.failure_reason = testCaseResult?.failure ? stripAnsi(testCaseResult?.failure) : testCaseResult.message;
        if (testCaseResult?.failureType) {
          testData.failure_type = testCaseResult.failureType.match(/AssertError/)
            ? 'AssertionError'
            : 'UnhandledError';
        }
      }
    }

    if (eventType === 'TestRunFinished') {
      const hooksList = this.getHooksListForTest(args);
      if (hooksList && hooksList.length > 0) {
        testData.hooks = hooksList;
        this.updateTestStatus(args, testData);
      }
    }

    const uploadData = {
      event_type: eventType,
      test_run: testData
    };
    await helper.uploadEventData(uploadData);

  }

  updateTestStatus(args, testData) {
    const testCaseStartedId = args.envelope.testCaseStartedId;
    const hookList = hooksMap[testCaseStartedId];
    if (hookList instanceof Array) {
      for (const hook of hookList) {
        if (hook.result === 'failed') {
          testData.result = hook.result;
          testData.failure = hook.failure_data;
          testData.failure_reason = (hook.failure_data instanceof Array) ? hook.failure_data[0]?.backtrace.join('\n') : '';
          testData.failure_type = hook.failure_type;
          
          return testData;
        }
      }
    };
  }

  getHooksListForTest(args) {
    const testCaseStartedId = args.envelope.testCaseStartedId;
    if (hooksMap[testCaseStartedId]) {
      return hooksMap[testCaseStartedId].map(hookDetail => hookDetail.uuid);
    }

    return [];
  }

  getHookRunEventData(args, eventType, hookData, testMetaData, hookType) {
    if (eventType === 'HookRunFinished') {
      const finishedAt = new Date().toISOString();
      const testCaseStartedId = args.envelope.testCaseStartedId;
      const hookList = hooksMap[testCaseStartedId];
      if (!hookList) {
        return;
      }

      const hookEventData = hookList.find(hook => hook.uuid === hookData.id);
      if (!hookEventData) {
        return;
      }
      const result = this.getHookResult(args);
      hookEventData.result = result.status;
      hookEventData.finished_at = finishedAt;
      hookEventData.failure_type = result.failureType;
      hookEventData.failure_data = [{backtrace: result.failureData}];

      return hookEventData;
    }
    const hookDetails = args.report.hooks.find(hookDetail => hookDetail.id === hookData.hookId);
    const relativeFilePath = hookDetails?.sourceReference?.uri;
    if (!relativeFilePath) {
      return;
    } else if (relativeFilePath.includes('setup_cucumber_runner')) {
      return;
    }
    const startedAt = new Date().toISOString();
    const result = 'pending';
    const hookTagsList = hookDetails.tagExpression ? hookDetails.tagExpression.split(' ').filter(val => val.includes('@')) : null;
    
    const hookEventData = {
      uuid: hookData.id,
      type: 'hook',
      hook_type: hookType,
      name: hookDetails?.name || '',
      body: {
        lang: 'NodeJs',
        code: null
      },
      tags: hookTagsList,
      scope: testMetaData?.feature?.name,
      scopes: [testMetaData?.feature?.name || ''],
      file_name: relativeFilePath,
      location: relativeFilePath,
      vc_filepath: (this._gitMetadata && this._gitMetadata.root) ? path.relative(this._gitMetadata.root, relativeFilePath) : null,
      result: result.status,
      started_at: startedAt,
      framework: 'nightwatch'
    };

    return hookEventData;
  }

  async sendHook(args, eventType, testSteps, testStepId, testMetaData) {
    const hookData = testSteps.find((testStep) => testStep.id === testStepId);
    if (!hookData.hookId) {
      return;
    }
    const testCaseStartedId = args.envelope.testCaseStartedId;
    const hookType = this.getCucumberHookType(testSteps, hookData);
    const hookRunEvent = this.getHookRunEventData(args, eventType, hookData, testMetaData, hookType);
    if (!hookRunEvent) {
      return;
    }
    if (eventType === 'HookRunStarted') {
      if (hooksMap[testCaseStartedId]) {
        hooksMap[testCaseStartedId].push(hookRunEvent);
      } else {
        hooksMap[testCaseStartedId] = [hookRunEvent];
      }
    }
    const hookEventUploadData = {
      event_type: eventType,
      hook_run: hookRunEvent
    };
    await helper.uploadEventData(hookEventUploadData);
  }

  getHookResult(args) {
    const testCaseStartedId = args.envelope.testCaseStartedId;
    const hookResult = args.report.testStepFinished[testCaseStartedId].testStepResult;
    let failure;
    let failureType;
    if (hookResult?.status.toString().toLowerCase() === 'failed') {
      failure = (hookResult?.exception === undefined) ? hookResult?.message : hookResult?.exception?.message;
      failureType = (hookResult?.exception === undefined) ? 'UnhandledError' : hookResult?.message.match(/Assert/) ? 'AssertionError' : 'UnhandledError';
    }

    return {
      status: hookResult.status.toLowerCase(),
      failureType: failureType || null,
      failureData: (!failure) ? null : [failure]
    };
  }

  // BEFORE_ALL and AFTER_ALL are not implemented for TO
  getCucumberHookType(testSteps, hookData) {
    let isStep = false;
    for (const step of testSteps) {
      if (step.pickleStepId) {
        isStep = true;
      }
      if (hookData.id === step.id) {
        return (isStep) ? 'AFTER_EACH' : 'BEFORE_EACH';
      }
    }
  }

  async appendTestItemLog (log, testUuid) {
    try {
      if (testUuid) {
        log.test_run_uuid = testUuid;
        await helper.uploadEventData({event_type: 'LogCreated', logs: [log]});
      }
    } catch (error) {
      Logger.error(`Exception in uploading log data to Test Reporting and Analytics with error : ${error}`);
    }
  }
}

module.exports = TestObservability;
