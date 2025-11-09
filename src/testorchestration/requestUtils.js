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

    return RequestUtils.makeOrchestrationRequest('POST', reqEndpoint, {data});
  }

  /**
   * Makes a request to the test orchestration split tests endpoint
   */
  static async testOrchestrationSplitTests(reqEndpoint, data) {
    Logger.debug('Processing Request for testOrchestrationSplitTests');

    return RequestUtils.makeOrchestrationRequest('POST', reqEndpoint, {data});
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
    const jwtToken = process.env.BROWSERSTACK_TESTHUB_JWT || '';
    
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
      // Log stack trace for debugging
      Logger.debug(`[makeOrchestrationRequest] Error during API Call: ${e.message || e} - ${reqEndpoint}`);
      
      return null;
    }
  }
}

module.exports = RequestUtils;