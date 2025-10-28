const {applyOrchestrationIfEnabled} = require('./applyOrchestration');
const OrchestrationUtils = require('./orchestrationUtils');
const Logger = require('../utils/logger');

/**
 * Test Orchestration integration for Nightwatch
 * This module provides functionality to apply test orchestration before test execution
 */
class TestOrchestrationIntegration {
  static _instance = null;

  constructor() {
    this.orchestrationUtils = null;
  }

  static getInstance() {
    if (!TestOrchestrationIntegration._instance) {
      TestOrchestrationIntegration._instance = new TestOrchestrationIntegration();
    }

    return TestOrchestrationIntegration._instance;
  }

  /**
   * Initialize test orchestration with the given settings
   */
  configure(settings) {
    try {
      this.orchestrationUtils = OrchestrationUtils.getInstance(settings);
      if (this.orchestrationUtils && this.orchestrationUtils.testOrderingEnabled()) {
        Logger.info('Test orchestration is configured and enabled.');
      } else {
        Logger.debug('Test orchestration is not enabled.');
      }
    } catch (error) {
      Logger.error(`Error configuring test orchestration: ${error}`);
    }
  }

  /**
   * Apply test orchestration to specs if enabled
   */
  async applyOrchestration(specs, settings) {
    if (!specs || !Array.isArray(specs) || specs.length === 0) {
      Logger.debug('No specs provided for test orchestration.');

      return specs;
    }

    try {
      Logger.info('Applying test orchestration...');
      const orderedSpecs = await applyOrchestrationIfEnabled(specs, settings);
      
      if (orderedSpecs && orderedSpecs.length > 0 && orderedSpecs !== specs) {
        Logger.info(`Test orchestration applied. Spec order changed from [${specs.join(', ')}] to [${orderedSpecs.join(', ')}]`);

        return orderedSpecs;
      } 
      Logger.info('Test orchestration completed. No changes to spec order.');

      return specs;
      
    } catch (error) {
      Logger.error(`Error applying test orchestration: ${error}`);

      return specs;
    }
  }

  /**
   * Collect build data after test execution
   */
  async collectBuildData(settings) {
    try {
      if (this.orchestrationUtils) {
        Logger.info('Collecting build data...');
        const response = await this.orchestrationUtils.collectBuildData(settings);
        if (response) {
          Logger.debug('Build data collection completed successfully.');
        } else {
          Logger.debug('Build data collection returned no response.');
        }

        return response;
      }
    } catch (error) {
      Logger.error(`Error collecting build data: ${error}`);
    }

    return null;
  }

  /**
   * Check if test orchestration is enabled
   */
  isEnabled() {
    return this.orchestrationUtils && this.orchestrationUtils.testOrderingEnabled();
  }
}

module.exports = TestOrchestrationIntegration;