const LocalTunnel = require('../src/local-tunnel');
const TestObservability = require('../src/testObservability');
const {CUSTOM_REPORTER_CALLBACK_TIMEOUT, PID_MAPPING_REGEX, IPC_SERVER_NAME, IPC_EVENTS} = require('../src/utils/constants');
const CrashReporter = require('../src/utils/crashReporter');
const helper = require('../src/utils/helper');
const Logger = require('../src/utils/logger');
const {v4: uuidv4} = require('uuid');
const ipc = require('node-ipc');
const path = require('path');

const localTunnel = new LocalTunnel();
const testObservability = new TestObservability();

const nightwatchRerun = process.env.NIGHTWATCH_RERUN_FAILED;
const nightwatchRerunFile = process.env.NIGHTWATCH_RERUN_REPORT_FILE;
const _tests = {};
const _testCasesData = {};

const pidMapping = (data) => {
  const {loggingData, pid} = data;
  _testCasesData[pid] = loggingData.message.replace('TEST-OBSERVABILITY-PID-TESTCASE-MAPPING-', '').slice(1, -1);
};


const uploadTestLog = async (data) => {
  try {
    const {loggingData, pid} = data;
    const uuid = getUUIDFromPID(pid);
    testObservability.appendTestItemLog(loggingData, uuid);
  } catch (error) {
    CrashReporter.uploadCrashReport(error.message, error.stack);
  }
};

const getUUIDFromPID = (pid) => {
  if (_testCasesData[pid] === undefined) {return}
  const testCaseStartedId = _testCasesData[pid];
  const testCaseId = _testCasesData[testCaseStartedId].testCaseId;
  if (_tests[testCaseId] === undefined) {return}

  return _tests[testCaseId].uuid;
};

const handleScreenshotUpload = async (data) => {
  try {
    const {args, pid} = data;
    const uuid = getUUIDFromPID(pid);
    await testObservability.createScreenshotLogEvent(uuid, args.path, Date.now());    
  } catch (error) {
    CrashReporter.uploadCrashReport(error.message, error.stack);
  }
};

const startIPCServer = () => {
  ipc.config.id = IPC_SERVER_NAME;
  ipc.config.retry = 1500;
  ipc.config.silent = true;

  ipc.serve(() => {
    ipc.server.on(IPC_EVENTS.LOG_INIT, (data, socket) => {
      if (data.loggingData?.message.slice(1, -1).match(PID_MAPPING_REGEX)) {
        pidMapping(data);
      }
      ipc.server.emit(socket, 'response', 'Received Message at Server');
    });

    ipc.server.on(IPC_EVENTS.LOG, async (data, socket) => {
      await uploadTestLog(data);
      ipc.server.emit(socket, 'response', 'Received Message at Server');
    });

    ipc.server.on(IPC_EVENTS.SCREENSHOT, async(data, socket) => {
      if (data.args?.path) {
        await handleScreenshotUpload(data);
      }
      ipc.server.emit(socket, 'response', 'Received Message at Server');
    });
  
    ipc.server.on('socket.disconnected', () => {
    });
  });
  ipc.server.start();
};

module.exports = {

  reporter: async function(results, done) {
    if (!helper.isTestObservabilitySession()) {
      done(results);

      return;
    }
    try {
      const modulesWithEnv = results['modulesWithEnv'];
      const promises = [];
      for (const testSetting in modulesWithEnv) {
        for (const testFile in modulesWithEnv[testSetting]) {
          const completedSections = modulesWithEnv[testSetting][testFile].completed;

          for (const completedSection in completedSections) {
            if (completedSections[completedSection]) {
              delete completedSections[completedSection].steps;
              delete completedSections[completedSection].testcases;
            }
          }
          promises.push(testObservability.processTestReportFile(JSON.parse(JSON.stringify(modulesWithEnv[testSetting][testFile]))));
        }
      }

      await Promise.all(promises);
      done();
    } catch (error) {
      CrashReporter.uploadCrashReport(error.message, error.stack);
      Logger.error(`Something went wrong in processing report file for test observability - ${error.message} with stacktrace ${error.stack}`);
    }
    done(results);
  },

  registerEventHandlers(eventBroadcaster) {

    eventBroadcaster.on('TestCaseStarted', async (args) => {
      if (!helper.isTestObservabilitySession()) {
        return;
      }
      try {
        _testCasesData[args.envelope.id] = {
          ...args.envelope
        };
        const reportData = args.report;
        const testCaseId = reportData.testCaseStarted[args.envelope.id].testCaseId;
        const pickleId = reportData.testCases.find((testCase) => testCase.id === testCaseId).pickleId;
        const pickleData = reportData.pickle.find((pickle) => pickle.id === pickleId);
        const gherkinDocument = reportData?.gherkinDocument.find((document) => document.uri === pickleData.uri);
        const featureData = gherkinDocument.feature;
        const uniqueId = uuidv4();

        const testMetaData = {
          uuid: uniqueId,
          startedAt: new Date().toISOString()
        };
        if (pickleData) {
          testMetaData.scenario = {
            name: pickleData.name
          };
        }

        if (gherkinDocument && featureData) {
          testMetaData.feature = {
            path: gherkinDocument.uri,
            name: featureData.name,
            description: featureData.description
          };
        }
        _tests[testCaseId] = testMetaData;
        await testObservability.sendTestRunEventForCucumber(reportData, gherkinDocument, pickleData, 'TestRunStarted', testMetaData, args);
      } catch (error) {
        CrashReporter.uploadCrashReport(error.message, error.stack);
        Logger.error(`Something went wrong in processing report file for test observability - ${error.message} with stacktrace ${error.stack}`);
      }
    });

    eventBroadcaster.on('TestCaseFinished', async (args) => {
      if (!helper.isTestObservabilitySession()) {
        return;
      }
      try {
        const reportData = args.report;
        const testCaseId = _testCasesData[args.envelope.testCaseStartedId].testCaseId;

        const pickleId = reportData.testCases.find((testCase) => testCase.id === testCaseId).pickleId;
        const pickleData = reportData.pickle.find((pickle) => pickle.id === pickleId);
        const gherkinDocument = reportData?.gherkinDocument.find((document) => document.uri === pickleData.uri);
        const testMetaData = _tests[testCaseId];
        if (testMetaData) {
          delete _tests[testCaseId];
          testMetaData.finishedAt = new Date().toISOString();
          await testObservability.sendTestRunEventForCucumber(reportData, gherkinDocument, pickleData, 'TestRunFinished', testMetaData, args);
        }
      } catch (error) {
        CrashReporter.uploadCrashReport(error.message, error.stack);
        Logger.error(`Something went wrong in processing report file for test observability - ${error.message} with stacktrace ${error.stack}`);
      }
    });

    eventBroadcaster.on('TestStepStarted', (args) => {
      if (!helper.isTestObservabilitySession()) {
        return;
      }
      try {
        const reportData = args.report;
        const testCaseId = _testCasesData[args.envelope.testCaseStartedId].testCaseId;
        const pickleId = reportData.testCases.find((testCase) => testCase.id === testCaseId).pickleId;
        const pickleData = reportData.pickle.find((pickle) => pickle.id === pickleId);
        const testSteps = reportData.testCases.find((testCase) => testCase.id === testCaseId).testSteps;
        const testStepId = reportData.testStepStarted[args.envelope.testCaseStartedId].testStepId;
        const pickleStepId = testSteps.find((testStep) => testStep.id === testStepId).pickleStepId;
        if (pickleStepId && _tests['testStepId'] !== testStepId) {
          _tests['testStepId'] = testStepId;
          const pickleStepData = pickleData.steps.find((pickle) => pickle.id === pickleStepId);
          const testMetaData = _tests[testCaseId] || {steps: []};
          if (testMetaData && !testMetaData.steps) {
            testMetaData.steps = [];
          }
          testMetaData.steps?.push({
            id: pickleStepData.id,
            text: pickleStepData.text,
            started_at: new Date().toISOString()
          });
          _tests[testCaseId] = testMetaData;
        }
      } catch (error) {
        CrashReporter.uploadCrashReport(error.message, error.stack);
        Logger.error(`Something went wrong in processing report file for test observability - ${error.message} with stacktrace ${error.stack}`);
      }
    });

    eventBroadcaster.on('TestStepFinished', async (args) => {
      if (!helper.isTestObservabilitySession()) {
        return;
      }
      try {
        const reportData = args.report;
        const testCaseId = _testCasesData[args.envelope.testCaseStartedId].testCaseId;
        const testStepFinished = reportData.testStepFinished[args.envelope.testCaseStartedId];
        const pickleId = reportData.testCases.find((testCase) => testCase.id === testCaseId).pickleId;
        const pickleData = reportData.pickle.find((pickle) => pickle.id === pickleId);
        const testSteps = reportData.testCases.find((testCase) => testCase.id === testCaseId).testSteps;
        const testStepId = reportData.testStepFinished[args.envelope.testCaseStartedId].testStepId;
        const pickleStepId = testSteps.find((testStep) => testStep.id === testStepId).pickleStepId;
        if (pickleStepId && _tests['testStepId']) {
          const pickleStepData = pickleData.steps.find((pickle) => pickle.id === pickleStepId);
          const testMetaData = _tests[testCaseId] || {steps: []};
          if (!testMetaData.steps) {
            testMetaData.steps = [{
              id: pickleStepData.id,
              text: pickleStepData.text,
              finished_at: new Date().toISOString(),
              result: testStepFinished.testStepResult?.status,
              duration: testStepFinished.testStepResult?.duration?.seconds,
              failure: testStepFinished.testStepResult?.exception?.message,
              failureType: testStepFinished.testStepResult?.exception?.type
            }];
          } else {
            testMetaData.steps.forEach((step) => {
              if (step.id === pickleStepData.id) {
                step.finished_at = new Date().toISOString();
                step.result = testStepFinished.testStepResult?.status;
                step.duration = testStepFinished.testStepResult?.duration?.seconds;
                if (testStepFinished.testStepResult?.exception) {
                  step.failure = testStepFinished.testStepResult?.exception?.message;
                  step.failureType = testStepFinished.testStepResult?.exception?.type;
                } else {
                  step.failure = testStepFinished.testStepResult?.message;
                  step.failureType = 'UnhandledError';
                }
              }
            });
          }
          _tests[testCaseId] = testMetaData;
          delete _tests['testStepId'];
          if (testStepFinished.httpOutput && testStepFinished.httpOutput.length > 0) {
            for (const [index, output] of testStepFinished.httpOutput.entries()) {
              if (index % 2 === 0) {
                await testObservability.createHttpLogEvent(output, testStepFinished.httpOutput[index + 1], testMetaData.uuid);
              }
            }
          }
        }
      } catch (error) {
        CrashReporter.uploadCrashReport(error.message, error.stack);
        Logger.error(`Something went wrong in processing report file for test observability - ${error.message} with stacktrace ${error.stack}`);
      }
    });

    eventBroadcaster.on('ScreenshotCreated', async (args) => {
      if (!helper.isTestObservabilitySession()) {
        return;
      }

      const data  = {args: args, pid: process.pid};

      ipc.config.id = IPC_SERVER_NAME;
      ipc.config.retry = 1500;
      ipc.config.silent = true;

      try {
        ipc.connectTo(IPC_SERVER_NAME, async () => {
          await ipc.of.browserstackTestObservability.emit(IPC_EVENTS.SCREENSHOT, data);
        });
      } catch (error) {
        CrashReporter.uploadCrashReport(error.message, error.stack);
        Logger.error(`Something went wrong in processing report file for test observability - ${error.message} with stacktrace ${error.stack}`);
      }
    });
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
        if (helper.isCucumberTestSuite(settings)) {
          settings.test_runner.options['require'] = path.resolve(__dirname, 'observabilityLogPatcherHook.js');
        }
        settings.globals['customReporterCallbackTimeout'] = CUSTOM_REPORTER_CALLBACK_TIMEOUT;
        if (testObservability._user && testObservability._key) {
          await testObservability.launchTestSession();
          if (helper.isCucumberTestSuite(settings)) {startIPCServer()}
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
      process.env.NIGHTWATCH_RERUN_FAILED = nightwatchRerun;
      process.env.NIGHTWATCH_RERUN_REPORT_FILE = nightwatchRerunFile;
      if (process.env.BROWSERSTACK_RERUN === 'true' && process.env.BROWSERSTACK_RERUN_TESTS) {
        await helper.deleteRerunFile();
      }
      try {
        await testObservability.stopBuildUpstream();
        if (process.env.BS_TESTOPS_BUILD_HASHED_ID) {
          Logger.info(`\nVisit https://observability.browserstack.com/builds/${process.env.BS_TESTOPS_BUILD_HASHED_ID} to view build report, insights, and many more debugging information all at one place!\n`);
        }
      } catch (error) {
        Logger.error(`Something went wrong in stopping build session for test observability - ${error}`);
      }
      process.exit();
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
