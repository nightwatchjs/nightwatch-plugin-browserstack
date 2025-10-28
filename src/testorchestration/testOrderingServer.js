const path = require('path');
const Logger = require('../utils/logger');
const {getHostInfo, getGitMetadataForAiSelection, getProjectName, getBuildName} = require('../utils/helper');
const RequestUtils = require('./requestUtils');
const ORCHESTRATION_API_URL = 'https://collector-observability.browserstack.com';

/**
 * Handles test ordering orchestration with the BrowserStack server.
 */
class TestOrderingServer {
  /**
   * @param config Test orchestration config
   * @param logger Logger instance
   */
  constructor(config, logger) {
    this.config = config;
    this.logger = logger || Logger;
    this.ORDERING_ENDPOINT = 'testorchestration/api/v1/split-tests';
    this.requestData = null;
    this.defaultTimeout = 60;
    this.defaultTimeoutInterval = 5;
    this.splitTestsApiCallCount = 0;
    this._settings = config['@nightwatch/browserstack'] || {};
    this._bstackOptions = {};
    if (config && config.desiredCapabilities && config.desiredCapabilities['bstack:options']) {
      this._bstackOptions = config.desiredCapabilities['bstack:options'];
    }
  }

  /**
   * Initiates the split tests request and stores the response data for polling.
   */
  async splitTests(testFiles, orchestrationStrategy, orchestrationMetadata = {}) {
    try {
      let prDetails = [];
      const source = orchestrationMetadata['run_smart_selection']?.source;
      const isGithubAppApproach = Array.isArray(source) && source.length > 0 && source.every(src => src && typeof src === 'object' && !Array.isArray(src));
      if (orchestrationMetadata['run_smart_selection']?.enabled && !isGithubAppApproach) {
        const multiRepoSource = orchestrationMetadata['run_smart_selection']?.source;
        prDetails = getGitMetadataForAiSelection(multiRepoSource);
      }

      const payload = {
        tests: testFiles.map(f => ({filePath: f})),
        orchestrationStrategy,
        orchestrationMetadata,
        nodeIndex: parseInt(process.env.BROWSERSTACK_NODE_INDEX || '0'),
        totalNodes: parseInt(process.env.BROWSERSTACK_TOTAL_NODE_COUNT || '1'),
        projectName: getProjectName(this._settings, this._bstackOptions),
        buildName: getBuildName(this._settings, this._bstackOptions),
        buildRunIdentifier: process.env.BROWSERSTACK_BUILD_RUN_IDENTIFIER || '',
        hostInfo: getHostInfo(),
        prDetails
      };
      this.logger.debug(`[splitTests] Split tests payload: ${JSON.stringify(payload)}`);
      const response = await RequestUtils.testOrchestrationSplitTests(this.ORDERING_ENDPOINT, payload);
      if (response) {
        this.requestData = this._processSplitTestsResponse(response);
        this.logger.debug(`[splitTests] Split tests response: ${JSON.stringify(this.requestData)}`);
      } else {
        this.logger.error('[splitTests] Failed to get split tests response.');
      }
    } catch (e) {
      this.logger.error(`[splitTests] Exception in sending test files:: ${e}`);
    }
  }


  /**
   * Processes the split tests API response and extracts relevant fields.
   */
  _processSplitTestsResponse(response) {
    const responseData = {};
    responseData.timeout = response.timeout !== undefined ? response.timeout : this.defaultTimeout;
    responseData.timeoutInterval = response.timeoutInterval !== undefined ? response.timeoutInterval : this.defaultTimeoutInterval;

    const resultUrl = response.resultUrl;
    const timeoutUrl = response.timeoutUrl;

    // Remove the API prefix if present
    if (resultUrl) {
      responseData.resultUrl = resultUrl.includes(`${ORCHESTRATION_API_URL}/`) 
        ? resultUrl.split(`${ORCHESTRATION_API_URL}/`)[1] 
        : resultUrl;
    } else {
      responseData.resultUrl = null;
    }

    if (timeoutUrl) {
      responseData.timeoutUrl = timeoutUrl.includes(`${ORCHESTRATION_API_URL}/`) 
        ? timeoutUrl.split(`${ORCHESTRATION_API_URL}/`)[1] 
        : timeoutUrl;
    } else {
      responseData.timeoutUrl = null;
    }

    if (
      response.timeout === undefined ||
      response.timeoutInterval === undefined ||
      response.timeoutUrl === undefined ||
      response.resultUrl === undefined
    ) {
      this.logger.debug('[process_split_tests_response] Received null value(s) for some attributes in split tests API response');
    }

    return responseData;
  }

  /**
   * Retrieves the ordered test files from the orchestration server
   */
  async getOrderedTestFiles() {
    if (!this.requestData) {
      this.logger.error('[getOrderedTestFiles] No request data available to fetch ordered test files.');

      return null;
    }

    let testFilesJsonList = null;
    const testFiles = [];
    const startTimeMillis = Date.now();
    const timeoutInterval = parseInt(String(this.requestData.timeoutInterval || this.defaultTimeoutInterval), 10);
    const timeoutMillis = parseInt(String(this.requestData.timeout || this.defaultTimeout), 10) * 1000;
    const timeoutUrl = this.requestData.timeoutUrl;
    const resultUrl = this.requestData.resultUrl;

    if (resultUrl === null && timeoutUrl === null) {
      return null;
    }

    try {
      // Poll resultUrl until timeout or until tests are available
      while (resultUrl && (Date.now() - startTimeMillis) < timeoutMillis) {
        const response = await RequestUtils.getTestOrchestrationOrderedTests(resultUrl, {});
        if (response && response.tests) {
          testFilesJsonList = response.tests;
        }
        this.splitTestsApiCallCount++;
        if (testFilesJsonList) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, timeoutInterval * 1000));
        this.logger.debug(`[getOrderedTestFiles] Fetching ordered tests from result URL after waiting for ${timeoutInterval} seconds.`);
      }
      
      // If still not available, try timeoutUrl
      if (timeoutUrl && (!testFilesJsonList || testFilesJsonList.length === 0)) {
        this.logger.debug('[getOrderedTestFiles] Fetching ordered tests from timeout URL');
        const response = await RequestUtils.getTestOrchestrationOrderedTests(timeoutUrl, {});
        if (response && response.tests) {
          testFilesJsonList = response.tests;
        }
      }

      // Extract file paths
      if (testFilesJsonList && testFilesJsonList.length > 0) {
        for (const testData of testFilesJsonList) {
          const filePath = testData.filePath;
          if (filePath) {
            testFiles.push(filePath);
          }
        }
      }

      if (!testFilesJsonList) {
        return null;
      }
      
      this.logger.debug(`[getOrderedTestFiles] Ordered test files received: ${JSON.stringify(testFiles)}`);

      return testFiles;
    } catch (e) {
      this.logger.error(`[getOrderedTestFiles] Exception in fetching ordered test files: ${e}`);

      return null;
    }
  }

  /**
   * Returns the count of split tests API calls made.
   */
  getSplitTestsApiCallCount() {
    return this.splitTestsApiCallCount;
  }
}

module.exports = TestOrderingServer;