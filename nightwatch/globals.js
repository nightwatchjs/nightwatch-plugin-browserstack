const LocalTunnel = require('../src/local-tunnel');
const TestObservability = require('../src/testObservability');
const {CUSTOM_REPORTER_CALLBACK_TIMEOUT} = require('../src/utils/constants');
const CrashReporter = require('../src/utils/crashReporter');
const helper = require('../src/utils/helper');
const Logger = require('../src/utils/logger');
const {v4: uuidv4} = require('uuid');

const localTunnel = new LocalTunnel();
const testObservability = new TestObservability();

const nightwatchRerun = process.env.NIGHTWATCH_RERUN_FAILED;
const nightwatchRerunFile = process.env.NIGHTWATCH_RERUN_REPORT_FILE;
const eventIdData = {};

module.exports = {

  registerEventHandlers(eventBroadcaster) {
    if (helper.isTestObservabilitySession()) {
      eventBroadcaster.on('TestSuiteStarted', (args) => {
        if (typeof browser !== 'undefined') {
          browser.execute(`browserstack_executor: {"action": "annotate", "arguments": {"type":"Annotation","data":"ObservabilitySync:${Date.now()}","level": "debug"}}`);
        }
      });
      eventBroadcaster.on('HookRunStarted', async (args) => {
        try {
          if (args.testResults?.results && !eventIdData.markedStatus) {
            if (args.hook_type === 'before' || args.hook_type === 'after') {
              const hookType = args.hook_type === 'before' ? 'BEFORE_ALL' : 'AFTER_ALL';
              const sectionName = args.hook_type === 'before' ? '__before_hook' : '__after_hook';
              eventIdData.id = uuidv4();
              eventIdData.markedStatus = true;
              const eventData = {
                startTimestamp: Date.now()
              };
              await testObservability.sendTestRunEvent(eventData, args.testResults.results, 'HookRunStarted', eventIdData.id, hookType, sectionName);
            }
          }
        } catch (error) {
          CrashReporter.uploadCrashReport(error.message, error.stack);
        }
      });
      eventBroadcaster.on('HookRunFinished', async (args) => {
        try {
          if (args.testResults?.results && eventIdData.markedStatus) {
            if (args.hook_type === 'before' || args.hook_type === 'after') {
              const hookType = args.hook_type === 'before' ? 'BEFORE_ALL' : 'AFTER_ALL';
              const sectionName = args.hook_type === 'before' ? '__before_hook' : '__after_hook';
              delete eventIdData.markedStatus;
              const eventData = args.testResults.results.completedSections[sectionName];
              await testObservability.sendTestRunEvent(eventData, args.testResults.results, 'HookRunStarted', eventIdData.id, hookType, sectionName);
            }
          }
        } catch (error) {
          CrashReporter.uploadCrashReport(error.message, error.stack);
        }
      });
      eventBroadcaster.on('TestRunStarted', async (args) => {
        try {
          if (args.testResults?.results && !eventIdData.markedStatus) {
            eventIdData.id = uuidv4();
            eventIdData.markedStatus = true;
            const eventData = {
              startTimestamp: Date.now()
            };
            const sectionName = args.test_name;
            await testObservability.sendTestRunEvent(eventData, args.testResults.results, 'TestRunStarted', eventData.id, null, sectionName);
          }
        } catch (error) {
          CrashReporter.uploadCrashReport(error.message, error.stack);
        }
      });
      eventBroadcaster.on('TestRunFinished', async (args) => {
        try {
          if (args.testResults?.results && eventIdData.markedStatus) {
            delete eventIdData.markedStatus;
            const sectionName = args.test_name;
            const eventData = args.testResults.results.completedSections[sectionName];
            await testObservability.sendTestRunEvent(eventData, args.testResults.results, 'TestRunFinished', eventData.id, null, sectionName);
          }
        } catch (error) {
          CrashReporter.uploadCrashReport(error.message, error.stack);
        }
      });
      eventBroadcaster.on('ScreenshotCreated', async (args) => {
        try {
          if (args.path && eventIdData.markedStatus) {
            await testObservability.createScreenshotLogEvent(eventIdData.id, args.path, Date.now());
          }
        } catch (error) {
          CrashReporter.uploadCrashReport(error.message, error.stack);
        }
      });
      eventBroadcaster.on('LogCreated', async (args) => {
        try {
          if (args.httpOutput?.length > 0 && eventIdData.markedStatus) {
            await testObservability.createHttpLogEvent(args.httpOutput[0], args.httpOutput[1], eventIdData.id);
          }
        } catch (error) {
          CrashReporter.uploadCrashReport(error.message, error.stack);
        }
      });
      eventBroadcaster.on('TestSuiteFinished', async (args) => {
        try {
          if (args.testResults?.results) {
            const testFileReport = args.testResults.results;
            const skippedTests = testFileReport['skippedAtRuntime'].concat(testFileReport['skippedByUser']);
            await testObservability.sendSkippedTestEvent(skippedTests, testFileReport);
          }
        } catch (error) {
          CrashReporter.uploadCrashReport(error.message, error.stack);
        }
      });
    }
  },

  async before(settings) {
    localTunnel.configure(settings);
    await localTunnel.start();

    // default config for plugin- local: false
    if (localTunnel._localTunnel && localTunnel._localTunnel.isRunning()) {
      if (!settings.desiredCapabilities['bstack:options']) {
        settings.desiredCapabilities['bstack:options'] = {};
      }

      settings.desiredCapabilities['bstack:options'].local = true;
      // Adding envs to be updated at beforeChildProcess.
      process.env.BROWSERSTACK_LOCAL_ENABLED = true;
      if (localTunnel._localOpts.localIdentifier) {
        process.env.BROWSERSTACK_LOCAL_IDENTIFIER = localTunnel._localOpts.localIdentifier;
        settings.desiredCapabilities['bstack:options'].localIdentifier = localTunnel._localOpts.localIdentifier;
      }
    }

    try {
      testObservability.configure(settings);
      if (helper.isTestObservabilitySession()) {
        settings.globals['customReporterCallbackTimeout'] = CUSTOM_REPORTER_CALLBACK_TIMEOUT;
        if (testObservability._user && testObservability._key) {
          await testObservability.launchTestSession();
        }
        if (process.env.BROWSERSTACK_RERUN === 'true' && process.env.BROWSERSTACK_RERUN_TESTS && process.env.BROWSERSTACK_RERUN_TESTS!=='null') {
          const specs = process.env.BROWSERSTACK_RERUN_TESTS.split(',');
          await helper.handleNightwatchRerun(specs);
        }
      } 
    } catch (error) {
      Logger.error(`Could not configure or launch test observability - ${error}`);
    }

  },

  async after() {
    localTunnel.stop();
    if (helper.isTestObservabilitySession()) {
      try {
        await testObservability.stopBuildUpstream();
        if (process.env.BS_TESTOPS_BUILD_HASHED_ID) {
          Logger.info(`\nVisit https://observability.browserstack.com/builds/${process.env.BS_TESTOPS_BUILD_HASHED_ID} to view build report, insights, and many more debugging information all at one place!\n`);
        }
      } catch (error) {
        Logger.error(`Something went wrong in stopping build session for test observability - ${error}`);
      }
      process.env.NIGHTWATCH_RERUN_FAILED = nightwatchRerun;
      process.env.NIGHTWATCH_RERUN_REPORT_FILE = nightwatchRerunFile;
      if (process.env.BROWSERSTACK_RERUN === 'true' && process.env.BROWSERSTACK_RERUN_TESTS) {
        await helper.deleteRerunFile();
      }
    }
  },

  beforeChildProcess(settings) {

    if (!settings.desiredCapabilities['bstack:options']) {
      settings.desiredCapabilities['bstack:options'] = {};
    }

    if (!helper.isUndefined(process.env.BROWSERSTACK_LOCAL_ENABLED) && process.env.BROWSERSTACK_LOCAL_ENABLED.toString() === 'true') {
      settings.desiredCapabilities['bstack:options'].local = process.env.BROWSERSTACK_LOCAL_ENABLED;
    }

    if (process.env.BROWSERSTACK_LOCAL_IDENTIFIER) {
      settings.desiredCapabilities['bstack:options'].localIdentifier = process.env.BROWSERSTACK_LOCAL_IDENTIFIER;
    }
  }
};
