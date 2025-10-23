const path = require('path');
const {performance} = require('perf_hooks');
const Logger = require('../utils/logger');
const TestOrderingServer = require('./testOrderingServer');
const OrchestrationUtils = require('./orchestrationUtils');

/**
 * Handles test orchestration operations for Nightwatch
 */
class TestOrchestrationHandler {
  static _instance = null;

  constructor(config) {
    this.config = config;
    this.logger = Logger;
    this.testOrderingServerHandler = new TestOrderingServer(this.config, this.logger);
    this.orchestrationUtils = new OrchestrationUtils(config);
    this.orderingInstrumentationData = {};
    this.testOrderingApplied = false;
    
    // Check if test orchestration is enabled
    this.isTestOrderingEnabled = this._checkTestOrderingEnabled();
  }

  /**
   * Get or create an instance of TestOrchestrationHandler
   */
  static getInstance(config) {
    if (TestOrchestrationHandler._instance === null && config !== null) {
      TestOrchestrationHandler._instance = new TestOrchestrationHandler(config);
    }
    return TestOrchestrationHandler._instance;
  }

  /**
   * Checks if test ordering is enabled
   */
  _checkTestOrderingEnabled() {
    // Extract test orchestration options from config
    const testOrchOptions = this._getTestOrchestrationOptions();
    const runSmartSelection = testOrchOptions?.runSmartSelection;
    
    return Boolean(runSmartSelection?.enabled);
  }

  /**
   * Extract test orchestration options from various config paths
   */
  _getTestOrchestrationOptions() {
    // Check direct config path
    if (this.config.testOrchestrationOptions) {
      return this.config.testOrchestrationOptions;
    }

    // Check browserstack plugin options
    const bsOptions = this.config['@nightwatch/browserstack'];
    if (bsOptions?.testOrchestrationOptions) {
      return bsOptions.testOrchestrationOptions;
    }

    return {};
  }

  /**
   * Checks if test ordering is enabled
   */
  testOrderingEnabled() {
    return this.isTestOrderingEnabled;
  }

  /**
   * Checks if test ordering is applied
   */
  isTestOrderingApplied() {
    return this.testOrderingApplied;
  }

  /**
   * Sets whether test ordering is applied
   */
  setTestOrderingApplied(orderingApplied) {
    this.testOrderingApplied = orderingApplied;
    this.addToOrderingInstrumentationData('applied', orderingApplied);
  }

  /**
   * Reorders test files based on the orchestration strategy
   */
  async reorderTestFiles(testFiles) {
    try {
      if (!testFiles || testFiles.length === 0) {
        this.logger.debug('[reorderTestFiles] No test files provided for ordering.');
        return null;
      }

      const orchestrationStrategy = this.orchestrationUtils.getTestOrderingName();
      const orchestrationMetadata = this.orchestrationUtils.getTestOrchestrationMetadata();

      if (orchestrationStrategy === null) {
        this.logger.error('Orchestration strategy is None. Cannot proceed with test orchestration session.');
        return null;
      }

      this.logger.info(`Reordering test files with orchestration strategy: ${orchestrationStrategy}`);

      // Use server handler approach for test file orchestration
      await this.testOrderingServerHandler.splitTests(testFiles, orchestrationStrategy, orchestrationMetadata);
      const orderedTestFiles = await this.testOrderingServerHandler.getOrderedTestFiles() || [];

      this.addToOrderingInstrumentationData('uploadedTestFilesCount', testFiles.length);
      this.addToOrderingInstrumentationData('nodeIndex', parseInt(process.env.BROWSERSTACK_NODE_INDEX || '0'));
      this.addToOrderingInstrumentationData('totalNodes', parseInt(process.env.BROWSERSTACK_NODE_COUNT || '1'));
      this.addToOrderingInstrumentationData('downloadedTestFilesCount', orderedTestFiles.length);
      this.addToOrderingInstrumentationData('splitTestsAPICallCount', this.testOrderingServerHandler.getSplitTestsApiCallCount());

      return orderedTestFiles;
    } catch (e) {
      this.logger.debug(`[reorderTestFiles] Error in ordering test classes: ${e}`);
    }
    return null;
  }

  /**
   * Adds data to the ordering instrumentation data
   */
  addToOrderingInstrumentationData(key, value) {
    this.orderingInstrumentationData[key] = value;
  }

  /**
   * Gets the ordering instrumentation data
   */
  getOrderingInstrumentationData() {
    return this.orderingInstrumentationData;
  }
}

module.exports = TestOrchestrationHandler;