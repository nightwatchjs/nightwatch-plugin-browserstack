const {makeRequest} = require('../utils/requestHelper');
const Logger = require('../utils/logger');

/**
 * Utility class for making API requests to the BrowserStack orchestration API
 */
class RequestUtils {
  /**
   * Makes a request to the collect build data endpoint
   */
  static async postCollectBuildData(reqEndpoint, data) {
    Logger.debug('Processing Request for postCollectBuildData');
    return RequestUtils.makeOrchestrationRequest('POST', reqEndpoint, { data });
  }

  /**
   * Makes a request to the test orchestration split tests endpoint
   */
  static async testOrchestrationSplitTests(reqEndpoint, data) {
    Logger.debug('Processing Request for testOrchestrationSplitTests');
    return RequestUtils.makeOrchestrationRequest('POST', reqEndpoint, { data });
  }

  /**
   * Gets ordered tests from the test orchestration
   */
  static async getTestOrchestrationOrderedTests(reqEndpoint, data) {
    Logger.debug('Processing Request for getTestOrchestrationOrderedTests');
    return RequestUtils.makeOrchestrationRequest('GET', reqEndpoint, {});
  }

  /**
   * Makes an orchestration request with the given method and data
   */
  static async makeOrchestrationRequest(method, reqEndpoint, options) {
    const jwtToken = process.env.BS_TESTOPS_JWT || '';
    
    // Validate JWT token
    if (!jwtToken) {
      Logger.error('BROWSERSTACK_TESTHUB_JWT environment variable is not set. This is required for test orchestration.');
      return null;
    }
    
    const config = {
      headers: {
        'authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 30000, // 30 second timeout
      retry: 3 // Retry failed requests
    };

    if (options.extraHeaders) {
      Object.assign(config.headers, options.extraHeaders);
    }

    const ORCHESTRATION_API_URL = 'https://collector-observability.browserstack.com';
    const fullUrl = `${ORCHESTRATION_API_URL}/${reqEndpoint}`;
    
    try {
      Logger.debug(`Orchestration request: ${method} ${fullUrl}`);
      Logger.debug(`Request payload size: ${options.data ? JSON.stringify(options.data).length : 0} bytes`);

      const response = await makeRequest(method, reqEndpoint, options.data, config, ORCHESTRATION_API_URL, false);

      Logger.debug(`Orchestration request completed successfully: ${reqEndpoint}`);

      let responseObj = {};
      try {
        responseObj = response.data || response;
      } catch (e) {
        Logger.debug(`Failed to parse JSON response: ${e}`);
      }

      if (responseObj && response.headers) {
        responseObj.next_poll_time = response.headers['next_poll_time'] || String(Date.now());
        responseObj.status = response.status;
      }

      return responseObj;
    } catch (e) {
      // Enhanced error logging for better diagnosis
      if (e.code === 'EPIPE') {
        Logger.error(`❌ Network connection error (EPIPE) when calling orchestration API`);
        Logger.error(`   URL: ${fullUrl}`);
        Logger.error(`   This usually indicates a network connectivity issue or the connection was closed unexpectedly`);
        Logger.error(`   Please check your internet connection and BrowserStack service status`);
      } else if (e.code === 'ECONNREFUSED') {
        Logger.error(`❌ Connection refused when calling orchestration API`);
        Logger.error(`   URL: ${fullUrl}`);
        Logger.error(`   The BrowserStack orchestration service may be unavailable`);
      } else if (e.code === 'ENOTFOUND') {
        Logger.error(`❌ DNS resolution failed for orchestration API`);
        Logger.error(`   URL: ${fullUrl}`);
        Logger.error(`   Please check your DNS settings and network connectivity`);
      } else if (e.response && e.response.status === 401) {
        Logger.error(`❌ Authentication failed for orchestration API`);
        Logger.error(`   Please check your BROWSERSTACK_TESTHUB_JWT token`);
      } else if (e.response && e.response.status === 403) {
        Logger.error(`❌ Access forbidden for orchestration API`);
        Logger.error(`   Your account may not have access to test orchestration features`);
      } else {
        Logger.error(`❌ Orchestration request failed: ${e.message || e} - ${reqEndpoint}`);
        if (e.response) {
          Logger.error(`   Response status: ${e.response.status}`);
          Logger.error(`   Response data: ${JSON.stringify(e.response.data)}`);
        }
      }
      
      // Log stack trace for debugging
      Logger.debug(`Error stack trace: ${e.stack}`);
      
      return null;
    }
  }
}

module.exports = RequestUtils;