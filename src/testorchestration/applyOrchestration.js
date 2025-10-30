const {performance} = require('perf_hooks');
const Logger = require('../utils/logger');
const TestOrchestrationHandler = require('./testOrchestrationHandler');

/**
 * Applies test orchestration to the Nightwatch test run
 * This function is the main entry point for the orchestration integration
 */
async function applyOrchestrationIfEnabled(specs, config) {
  // Initialize orchestration handler
  const orchestrationHandler = TestOrchestrationHandler.getInstance(config);
  
  if (!orchestrationHandler) {
    Logger.warn('Orchestration handler is not initialized. Skipping orchestration.');

    return specs;
  }

  // Check if runSmartSelection is enabled in config
  const testOrchOptions = config.testOrchestrationOptions || config['@nightwatch/browserstack']?.testOrchestrationOptions || {};
  const runSmartSelectionEnabled = Boolean(testOrchOptions?.runSmartSelection?.enabled);
  
  if (!runSmartSelectionEnabled) {
    Logger.info('runSmartSelection is not enabled in config. Skipping orchestration.');

    return specs;
  }

  // Check if orchestration is enabled
  let testOrderingApplied = false;
  orchestrationHandler.addToOrderingInstrumentationData('enabled', orchestrationHandler.testOrderingEnabled());
  
  const startTime = performance.now();
    
  // Get the test files from the specs
  const testFiles = specs;
  testOrderingApplied = true;
  
  // Reorder the test files
  const orderedFiles = await orchestrationHandler.reorderTestFiles(testFiles);
  
  if (orderedFiles && orderedFiles.length > 0) {
    orchestrationHandler.setTestOrderingApplied(testOrderingApplied);
    Logger.info(`Tests reordered using orchestration: ${orderedFiles.join(', ')}`);
    
    // Return the ordered files as the new specs
    orchestrationHandler.addToOrderingInstrumentationData(
      'timeTakenToApply', 
      Math.floor(performance.now() - startTime) // Time in milliseconds
    );
    
    return orderedFiles;
  } 
  Logger.info('No test files were reordered by orchestration.');
  orchestrationHandler.addToOrderingInstrumentationData(
    'timeTakenToApply', 
    Math.floor(performance.now() - startTime) // Time in milliseconds
  );
  
  
  return specs;
}

module.exports = {
  applyOrchestrationIfEnabled
};