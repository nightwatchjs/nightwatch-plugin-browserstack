/**
 * Nightwatch Test Orchestration Module
 * 
 * This module provides test orchestration functionality for Nightwatch tests
 * using BrowserStack's AI-powered test selection and ordering capabilities.
 * 
 * @module nightwatch-test-orchestration
 */

// Core orchestration classes
const TestOrchestrationHandler = require('./testOrchestrationHandler');
const TestOrderingServer = require('./testOrderingServer');
const OrchestrationUtils = require('./orchestrationUtils');
const TestOrchestrationIntegration = require('./testOrchestrationIntegration');

// Utility classes
const RequestUtils = require('./requestUtils');
const { getHostInfo, getGitMetadataForAiSelection } = require('./helpers');

// Main API and application functions
const { applyOrchestrationIfEnabled } = require('./applyOrchestration');

/**
 * Main Test Orchestration class that provides the primary interface
 */
class NightwatchTestOrchestration {
  constructor() {
    this.handler = null;
    this.integration = TestOrchestrationIntegration.getInstance();
  }

  /**
   * Initialize test orchestration with configuration
   * @param {Object} config - Nightwatch configuration object
   */
  initialize(config) {
    this.handler = TestOrchestrationHandler.getInstance(config);
    this.integration.configure(config);
    return this;
  }

  /**
   * Apply orchestration to test specs
   * @param {Array} specs - Array of test file paths
   * @param {Object} config - Configuration object
   * @returns {Promise<Array>} - Ordered test specs
   */
  async applyOrchestration(specs, config) {
    if (!this.handler) {
      this.initialize(config);
    }
    return await applyOrchestrationIfEnabled(specs, config);
  }

  /**
   * Collect build data after test execution
   * @param {Object} config - Configuration object
   * @returns {Promise<Object>} - Build data response
   */
  async collectBuildData(config) {
    if (!this.handler) {
      this.initialize(config);
    }
    const utils = OrchestrationUtils.getInstance(config);
    return await utils.collectBuildData(config);
  }

  /**
   * Check if test orchestration is enabled
   * @param {Object} config - Configuration object
   * @returns {boolean} - True if orchestration is enabled
   */
  isEnabled(config) {
    if (!this.handler) {
      this.initialize(config);
    }
    return this.handler.testOrderingEnabled();
  }
}

// Create main instance
const testOrchestration = new NightwatchTestOrchestration();

// Export main interface
module.exports = {
  // Main class
  NightwatchTestOrchestration,
  
  // Primary instance
  testOrchestration,
  
  // Core classes
  TestOrchestrationHandler,
  TestOrderingServer,
  OrchestrationUtils,
  TestOrchestrationIntegration,
  
  // Utilities
  RequestUtils,
  helpers: {
    getHostInfo,
    getGitMetadataForAiSelection
  },
  
  // Main functions
  applyOrchestrationIfEnabled,
  
  // API methods (convenient access)
  initialize: (config) => testOrchestration.initialize(config),
  applyOrchestration: (specs, config) => testOrchestration.applyOrchestration(specs, config),
  collectBuildData: (config) => testOrchestration.collectBuildData(config),
  isEnabled: (config) => testOrchestration.isEnabled(config)
};