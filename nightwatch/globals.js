const LocalTunnel = require('../src/local-tunnel');
const TestObservability = require('../src/testObservability');
const {CUSTOM_REPORTER_CALLBACK_TIMEOUT, EVENTS} = require('../src/utils/constants');
const CrashReporter = require('../src/utils/crashReporter');
const helper = require('../src/utils/helper');
const Logger = require('../src/utils/logger');
const {v4: uuidv4} = require('uuid');
const path = require('path');
const AccessibilityAutomation = require('../src/accessibilityAutomation');
const eventHelper = require('../src/utils/eventHelper');
const OrchestrationUtils = require('../src/testorchestration/orchestrationUtils');
const TestMap = require('../src/utils/testMap');
const localTunnel = new LocalTunnel();
const testObservability = new TestObservability();
const accessibilityAutomation = new AccessibilityAutomation();

const nightwatchRerun = process.env.NIGHTWATCH_RERUN_FAILED;
const nightwatchRerunFile = process.env.NIGHTWATCH_RERUN_REPORT_FILE;
const _tests = {};
const _testCasesData = {};
let currentTestUUID = '';
let workerList = {};
let testRunner = "";

eventHelper.eventEmitter.on(EVENTS.LOG_INIT, (loggingData) => {
  const testCaseStartedId = loggingData.message.replace('TEST-OBSERVABILITY-PID-TESTCASE-MAPPING-', '').slice(1, -1);
  const testCaseId = _testCasesData[testCaseStartedId]?.testCaseId;
  currentTestUUID = _tests[testCaseId]?.uuid;
});

eventHelper.eventEmitter.on(EVENTS.LOG, (loggingData) => {
  if (currentTestUUID && currentTestUUID !== '') {
    testObservability.appendTestItemLog(loggingData, currentTestUUID);
  }
});

const handleScreenshotUpload = async (data) => {
  try {
    const {args, uuid} = data;
    await testObservability.createScreenshotLogEvent(uuid, args.path, Date.now());
  } catch (error) {
    CrashReporter.uploadCrashReport(error.message, error.stack);
  }
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
      Logger.error(`Something went wrong in processing report file for test reporting and analytics - ${error.message} with stacktrace ${error.stack}`);
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
        process.env.TEST_OPS_TEST_UUID = uniqueId;

        Object.values(workerList).forEach((worker) => {
          worker.process.on('message', async (data) => {
            if (data.POST_SESSION_EVENT) {
              helper.storeSessionsData(data);
            }
            if (data.eventType === EVENTS.LOG_INIT) {
              const testCaseStartedId = data.loggingData.message.replace('TEST-OBSERVABILITY-PID-TESTCASE-MAPPING-', '').slice(1, -1);
              const testCaseId = _testCasesData[testCaseStartedId]?.testCaseId;
              const uuid = _tests[testCaseId]?.uuid;
              await worker.process.send({testCaseStartedId, uuid});
            }
          });
        });

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
        Logger.error(`Something went wrong in processing report file for test reporting and analytics - ${error.message} with stacktrace ${error.stack}`);
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
        Logger.error(`Something went wrong in processing report file for test reporting and analytics - ${error.message} with stacktrace ${error.stack}`);
      }
    });

    eventBroadcaster.on('TestStepStarted', async (args) => {
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
        await testObservability.sendHook(args, 'HookRunStarted', testSteps, testStepId, _tests[testCaseId]);
        const pickleStepId = testSteps.find((testStep) => testStep.id === testStepId).pickleStepId;
        if (pickleStepId && _tests[testCaseId]?.['testStepId'] !== testStepId) {
          _tests[testCaseId]['testStepId'] = testStepId;
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
        Logger.error(`Something went wrong in processing report file for test reporting and analytics - ${error.message} with stacktrace ${error.stack}`);
      }
    });

    eventBroadcaster.on('TestStepFinished', async (args) => {
      if (!helper.isTestObservabilitySession()) {
        return;
      }
      try {
        const reportData = args.report;
        helper.storeSessionsData(args);
        const testCaseId = _testCasesData[args.envelope.testCaseStartedId].testCaseId;
        const testStepFinished = reportData.testStepFinished[args.envelope.testCaseStartedId];
        const pickleId = reportData.testCases.find((testCase) => testCase.id === testCaseId).pickleId;
        const pickleData = reportData.pickle.find((pickle) => pickle.id === pickleId);
        const testSteps = reportData.testCases.find((testCase) => testCase.id === testCaseId).testSteps;
        const testStepId = reportData.testStepFinished[args.envelope.testCaseStartedId].testStepId;
        await testObservability.sendHook(args, 'HookRunFinished', testSteps, testStepId, _tests[testCaseId]);
        const pickleStepId = testSteps.find((testStep) => testStep.id === testStepId).pickleStepId;
        let failure;
        let failureType;
        if (testStepFinished.testStepResult?.status.toString().toLowerCase() === 'failed') {
          failure = (testStepFinished.testStepResult?.exception === undefined) ? testStepFinished.testStepResult?.message : testStepFinished.testStepResult?.exception?.message;
          failureType = (testStepFinished.testStepResult?.exception === undefined) ? 'UnhandledError' : testStepFinished.testStepResult?.message;
        }

        if (pickleStepId && _tests[testCaseId]['testStepId']) {
          const pickleStepData = pickleData.steps.find((pickle) => pickle.id === pickleStepId);
          const testMetaData = _tests[testCaseId] || {steps: []};
          if (!testMetaData.steps) {
            testMetaData.steps = [{
              id: pickleStepData.id,
              text: pickleStepData.text,
              finished_at: new Date().toISOString(),
              result: testStepFinished.testStepResult?.status,
              duration: testStepFinished.testStepResult?.duration?.seconds,
              failure: failure,
              failureType: failureType
            }];
          } else {
            testMetaData.steps.forEach((step) => {
              if (step.id === pickleStepData.id) {
                step.finished_at = new Date().toISOString();
                step.result = testStepFinished.testStepResult?.status;
                step.duration = testStepFinished.testStepResult?.duration?.seconds;
                step.failure = failure;
                step.failureType = failureType;
              }
            });
          }
          _tests[testCaseId] = testMetaData;
          delete _tests[testCaseId]['testStepId'];
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
        Logger.error(`Something went wrong in processing report file for test reporting and analytics - ${error.message} with stacktrace ${error.stack}`);
      }
    });

    eventBroadcaster.on('ScreenshotCreated', async (args) => {
      if (!helper.isTestObservabilitySession()) {return}
      handleScreenshotUpload({args: args, uuid: process.env.TEST_OPS_TEST_UUID});
    });

    eventBroadcaster.on('TestRunStarted', async (test) => {
      TestMap.storeTestDetails(test);
      const uuid = TestMap.getUUID(test);
      await accessibilityAutomation.beforeEachExecution(test)
      if (testRunner != "cucumber"){
        await testObservability.sendTestRunEvent('TestRunStarted', test, uuid)
      }
      
    });

    eventBroadcaster.on('TestRunFinished', async (test) => {
      const uuid = TestMap.getUUID(test);
      await accessibilityAutomation.afterEachExecution(test, uuid);
      if (testRunner != "cucumber"){
        await testObservability.sendTestRunEvent('TestRunFinished', test, uuid)
      }
      
    });
  },

  onEvent({eventName, hook_type, ...args}) {
    if (typeof browser !== 'undefined' && eventName === 'TestRunStarted') {
      browser.execute(`browserstack_executor: {"action": "annotate", "arguments": {"type":"Annotation","data":"ObservabilitySync:${Date.now()}","level": "debug"}}`);
    }
  },

  async before(settings, testEnvSettings) {
    testRunner = settings.test_runner.type;
    const pluginSettings = settings['@nightwatch/browserstack'];
    if (!settings.desiredCapabilities['bstack:options']) {
      settings.desiredCapabilities['bstack:options'] = {};
    }
   
    // Plugin identifier
    settings.desiredCapabilities['bstack:options']['browserstackSDK'] = `nightwatch-plugin/${helper.getAgentVersion()}`;

    localTunnel.configure(settings);
    await localTunnel.start();

    // default config for plugin- local: false
    if (localTunnel._localTunnel && localTunnel._localTunnel.isRunning()) {
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
      accessibilityAutomation.configure(settings);
      if (helper.isTestObservabilitySession()) {
        if (settings.reporter_options) {
          if (settings.reporter_options['save_command_result_value'] !== true){
            settings.reporter_options['save_command_result_value'] = true;
          }
        } else {
          settings.reporter_options = {
            save_command_result_value: true
          };
        }

        if (helper.isCucumberTestSuite(settings)) {
          cucumberPatcher();
          process.env.CUCUMBER_SUITE = 'true';
          settings.test_runner.options['require'] = path.resolve(__dirname, 'observabilityLogPatcherHook.js');
        }
        settings.globals['customReporterCallbackTimeout'] = CUSTOM_REPORTER_CALLBACK_TIMEOUT;
        if (helper.isTestObservabilitySession() || pluginSettings?.accessibility === true) {
          await testObservability.launchTestSession();
        }
        if (process.env.BROWSERSTACK_RERUN === 'true' && process.env.BROWSERSTACK_RERUN_TESTS && process.env.BROWSERSTACK_RERUN_TESTS!=='null') {
          const specs = process.env.BROWSERSTACK_RERUN_TESTS.split(',');
          await helper.handleNightwatchRerun(specs);
        }
      }
    } catch (error) {
      Logger.error(`Could not configure or launch test reporting and analytics - ${error}`);
    }
      
    try {
      if (helper.isAccessibilitySession() && !settings.parallel_mode) {
        accessibilityAutomation.setAccessibilityCapabilities(settings);
        accessibilityAutomation.commandWrapper();
      }
    } catch (err){
      Logger.debug(`Exception while setting Accessibility Automation capabilities. Error ${err}`);
    }
      
    
    // Initialize and configure test orchestration
    try {
      if (helper.isTestObservabilitySession()) {        
        const orchestrationUtils = OrchestrationUtils.getInstance(settings);
        if (orchestrationUtils && orchestrationUtils.testOrderingEnabled()){
          // Apply test orchestration to reorder test files before execution
          const TestOrchestrationIntegration = require('../src/testorchestration/testOrchestrationIntegration');
          const orchestrationIntegration = TestOrchestrationIntegration.getInstance();
          orchestrationIntegration.configure(settings);
                  
          // Check if we have test files to reorder from various sources
          let allTestFiles = [];
          
          // Checking either for Feature Path or src_folders, feature path take priority
          if (helper.isCucumberTestSuite(settings) && settings?.test_runner?.options?.feature_path){
            Logger.debug('Getting test files from feature_path configuration...');
            if (Array.isArray(settings.test_runner.options.feature_path)){
              settings.test_runner.options.feature_path.forEach(featurePath => {
                const files = helper.collectTestFiles(featurePath, 'feature_path config');
                allTestFiles = allTestFiles.concat(files);
              });
            } else if (typeof settings.test_runner.options.feature_path === 'string'){
              const files = helper.collectTestFiles(settings.test_runner.options.feature_path, 'feature_path config');
              allTestFiles = allTestFiles.concat(files);
            }
          } else if (settings.src_folders && Array.isArray(settings.src_folders) && settings.src_folders.length > 0) {
            Logger.debug('Getting test files from src_folders configuration...');
            settings.src_folders.forEach(folder => {
              const files = helper.collectTestFiles(folder, 'src_folders config');
              allTestFiles = allTestFiles.concat(files);
            });
          }

          // Remove duplicates and ensure all paths are relative to cwd
          allTestFiles = [...new Set(allTestFiles)].map(file => {
            return path.isAbsolute(file) ? path.relative(process.cwd(), file) : file;
          });


          if (allTestFiles.length > 0) {
            Logger.debug(`Applying test orchestration to reorder test files... Found ${allTestFiles.length} test files`);
            Logger.debug(`Test files: ${JSON.stringify(allTestFiles)}`);
            
            // Apply orchestration to get ordered test files (synchronously)
            try {
              const orderedFiles = await orchestrationIntegration.applyOrchestration(allTestFiles, settings);
              if (orderedFiles && orderedFiles.length > 0) {
                Logger.info(`Test files reordered by orchestration: ${orderedFiles.length} files`);
                                  
                try {
                  if (helper.isCucumberTestSuite(settings) && settings?.test_runner?.options?.feature_path){
                    // For cucumber, we override the feature_path option with ordered files
                    settings.test_runner.options['feature_path'] = orderedFiles;
                  } else {
                    settings.src_folders = orderedFiles;
                    for (const envName in testEnvSettings) {
                      testEnvSettings[envName].src_folders = orderedFiles;
                      testEnvSettings[envName].test_runner.src_folders = orderedFiles;
                    }
                    if (settings.test_runner && typeof settings.test_runner === 'object' && !Array.isArray(settings.test_runner)) {
                      settings.test_runner.src_folders = orderedFiles;
                    }
                  }
                    
                } catch (reorderError) {
                  Logger.error(`Runtime reordering failed: ${reorderError.message}`);
                  Logger.info('Falling back to original order for current execution.');
                } 
              } else {
                Logger.info('Split test API called - no reordering available');
              }
            } catch (error) {
              Logger.error(`Error applying test orchestration: ${error}`);
            }
          
          } else {
            Logger.debug('No test files found for orchestration - skipping split test API call');
          }
        }
      }
    } catch (error) {
      Logger.error(`Could not configure test orchestration - ${error}`);
    }

    addProductMapAndbuildUuidCapability(settings);
  },

  async after() {
    localTunnel.stop();
    
    // Collect build data for test orchestration if enabled
    try {
      if (helper.isTestObservabilitySession()) {
        const orchestrationUtils = OrchestrationUtils.getInstance();
        if (orchestrationUtils && orchestrationUtils.testOrderingEnabled()){

          Logger.info('Collecting build data for test orchestration...');
          await orchestrationUtils.collectBuildData(this.settings || {});
        }
      }
    } catch (error) {
      Logger.error(`Error collecting build data for test orchestration: ${error}`);
    }

    if (helper.isTestObservabilitySession() || helper.isAccessibilitySession()) {
      process.env.NIGHTWATCH_RERUN_FAILED = nightwatchRerun;
      process.env.NIGHTWATCH_RERUN_REPORT_FILE = nightwatchRerunFile;
      if (process.env.BROWSERSTACK_RERUN === 'true' && process.env.BROWSERSTACK_RERUN_TESTS) {
        await helper.deleteRerunFile();
      }
      try {
        await testObservability.stopBuildUpstream();
        if (process.env.BROWSERSTACK_TESTHUB_UUID) {
          Logger.info(`\nVisit https://automation.browserstack.com/builds/${process.env.BROWSERSTACK_TESTHUB_UUID} to view build report, insights, and many more debugging information all at one place!\n`);
        }
      } catch (error) {
        Logger.error(`Something went wrong in stopping build session for test reporting and analytics - ${error}`);
      }
      process.exit();
    }
  },

  async beforeEach(settings) {
    browser.getAccessibilityResults = () =>  { return accessibilityAutomation.getAccessibilityResults() };
    browser.getAccessibilityResultsSummary = () => { return accessibilityAutomation.getAccessibilityResultsSummary() };
  },

  // This will be run after each test suite is finished
  async afterEach(settings) {
  },

  beforeChildProcess(settings) {
   
    if (!settings.desiredCapabilities['bstack:options']) {
      settings.desiredCapabilities['bstack:options'] = {};
    }

    // Plugin identifier
    settings.desiredCapabilities['bstack:options']['browserstackSDK'] = `nightwatch-plugin/${helper.getAgentVersion()}`;

    if (!helper.isUndefined(process.env.BROWSERSTACK_LOCAL_ENABLED) && process.env.BROWSERSTACK_LOCAL_ENABLED.toString() === 'true') {
      settings.desiredCapabilities['bstack:options'].local = process.env.BROWSERSTACK_LOCAL_ENABLED;
    }

    if (process.env.BROWSERSTACK_LOCAL_IDENTIFIER) {
      settings.desiredCapabilities['bstack:options'].localIdentifier = process.env.BROWSERSTACK_LOCAL_IDENTIFIER;
    }

    // adding settings.reporter_options.save_command_result_value = true to ensure screenshot reporting to Observability
    if (helper.isTestObservabilitySession()) {
      if (settings.reporter_options) {
        if (settings.reporter_options['save_command_result_value'] !== true){
          settings.reporter_options['save_command_result_value'] = true;
        }
      } else {
        settings.reporter_options = {
          save_command_result_value: true
        };
      }
    }

    try {
      if (helper.isAccessibilitySession()) {
        accessibilityAutomation.setAccessibilityCapabilities(settings);
        accessibilityAutomation.commandWrapper();
      }
    } catch (err){
      Logger.debug(`Exception while setting Accessibility Automation capabilities. Error ${err}`);
    }
    addProductMapAndbuildUuidCapability(settings);

  }
};

const cucumberPatcher = () => {
  try {
    const Coordinator = helper.requireModule('@cucumber/cucumber/lib/runtime/parallel/coordinator.js');
    class CoordinatorPatcher extends Coordinator.default {
      constructor(...args) {
        super(...args);
      }

      startWorker(...args) {
        const workerData  = super.startWorker(...args);
        workerList = this.workers;

        return workerData;
      }

      parseWorkerMessage(...args) {
        if ([EVENTS.LOG, EVENTS.LOG_INIT].includes(args[1]?.eventType)) {return}

        return super.parseWorkerMessage(...args);
      }
    }
    Coordinator.default = CoordinatorPatcher;
  } catch (error) {
    Logger.debug(`Error while patching cucumber ${error}`);
  }
};

const addProductMapAndbuildUuidCapability = (settings) => {
  try {
    if (!settings?.desiredCapabilities) {
      return;
    }

    const product = helper.getObservabilityLinkedProductName(settings.desiredCapabilities, settings?.selenium?.host);

    const buildProductMap = {
      automate: product === 'automate',
      app_automate: product === 'app-automate',
      observability: helper.isTestObservabilitySession(),
      accessibility: helper.isAccessibilitySession(),
      turboscale: product === 'turboscale',
      percy: false
    };

    if (settings.desiredCapabilities['bstack:options']) {
      settings.desiredCapabilities['bstack:options']['buildProductMap'] = buildProductMap;
      settings.desiredCapabilities['bstack:options']['testhubBuildUuid'] = process.env.BROWSERSTACK_TESTHUB_UUID ? process.env.BROWSERSTACK_TESTHUB_UUID : '' ;
    } else {
      settings.desiredCapabilities['browserstack.buildProductMap'] = buildProductMap;
      settings.desiredCapabilities['browserstack.testhubBuildUuid'] = process.env.BROWSERSTACK_TESTHUB_UUID ? process.env.BROWSERSTACK_TESTHUB_UUID : '' ;
    }
  } catch (error) {
    Logger.debug(`Error while sending productmap and build capabilities ${error}`);
  }
};
