const path = require('path');
const fs = require('fs');
const {tmpdir} = require('os');
const Logger = require('../utils/logger');
const {getHostInfo} = require('../utils/helper');
const RequestUtils = require('./requestUtils');
const helper = require('../utils/helper');
// Constants
const RUN_SMART_SELECTION = 'runSmartSelection';
const ALLOWED_ORCHESTRATION_KEYS = [RUN_SMART_SELECTION];

/**
 * Class to handle test ordering functionality
 */
class TestOrdering {
  constructor() {
    this.enabled = false;
    this.name = null;
  }

  enable(name) {
    this.enabled = true;
    this.name = name;
  }

  disable() {
    this.enabled = false;
    this.name = null;
  }

  getEnabled() {
    return this.enabled;
  }

  getName() {
    return this.name;
  }
}

/**
 * Utility class for test orchestration
 */
class OrchestrationUtils {
  static _instance = null;

  /**
   * @param config Configuration object
   */
  constructor(config) {
    this._settings = config['@nightwatch/browserstack'] || {};
    this._bstackOptions = {};
    if (config && config.desiredCapabilities && config.desiredCapabilities['bstack:options']) {
      this._bstackOptions = config.desiredCapabilities['bstack:options'];
    }
    this.logger = Logger;
    this.runSmartSelection = false;
    this.smartSelectionMode = 'relevantFirst';
    this.testOrdering = new TestOrdering();
    this.smartSelectionSource = null; // Store source paths if provided
    
    // Check both possible configuration paths: direct or nested in browserstack options
    const testOrchOptions = this._getTestOrchestrationOptions(config);
    
    // Try to get runSmartSelection options
    const runSmartSelectionOpts = testOrchOptions[RUN_SMART_SELECTION] || {};
    
    this._setRunSmartSelection(
      runSmartSelectionOpts.enabled || false,
      runSmartSelectionOpts.mode || 'relevantFirst',
      runSmartSelectionOpts.source || null
    );
    
    // Extract build details
    this._extractBuildDetails();
  }

  /**
   * Extract test orchestration options from config
   */
  _getTestOrchestrationOptions(config) {
    // Check direct config path
    let testOrchOptions = config.testOrchestrationOptions || {};
    
    // If not found at top level, check if it's in the browserstack plugin config
    if (Object.keys(testOrchOptions).length === 0 && config['@nightwatch/browserstack']) {
      const bsOptions = config['@nightwatch/browserstack'];
      if (bsOptions.testOrchestrationOptions) {
        testOrchOptions = bsOptions.testOrchestrationOptions;
        this.logger.debug('[constructor] Found testOrchestrationOptions in browserstack plugin config');
      }
    }
    
    return testOrchOptions;
  }

  /**
   * Extract build details from config
   */
  _extractBuildDetails() {
    try {
      const fromProduct = {
        test_observability: true
      };
      this.buildName = helper.getBuildName(this._settings, this._bstackOptions, fromProduct) || '';

      this.projectName = helper.getProjectName(this._settings, this._bstackOptions, fromProduct) || '';

      this.buildIdentifier = process.env.BROWSERSTACK_BUILD_RUN_IDENTIFIER || '';
      
      this.logger.debug(`[_extractBuildDetails] Extracted - projectName: ${this.projectName}, buildName: ${this.buildName}, buildIdentifier: ${this.buildIdentifier}`);
    } catch (e) {
      this.logger.error(`[_extractBuildDetails] ${e}`);
    }
  }

  /**
   * Get or create an instance of OrchestrationUtils
   */
  static getInstance(config) {
    if (!OrchestrationUtils._instance && config) {
      OrchestrationUtils._instance = new OrchestrationUtils(config);
    }

    return OrchestrationUtils._instance;
  }

  /**
   * Get orchestration data from config
   */
  static getOrchestrationData(config) {
    const orchestrationData = config.testOrchestrationOptions || 
                              config['@nightwatch/browserstack']?.testOrchestrationOptions || 
                              {};
    const result = {};
    
    Object.entries(orchestrationData).forEach(([key, value]) => {
      if (ALLOWED_ORCHESTRATION_KEYS.includes(key)) {
        result[key] = value;
      }
    });
    
    return result;
  }

  /**
   * Check if the abort build file exists
   */
  static checkAbortBuildFileExists() {
    const buildUuid = process.env.BS_TESTOPS_BUILD_HASHED_ID;
    const filePath = path.join(tmpdir(), `abort_build_${buildUuid}`);

    return fs.existsSync(filePath);
  }

  /**
   * Write failure to file
   */
  static writeFailureToFile(testName) {
    const buildUuid = process.env.BS_TESTOPS_BUILD_HASHED_ID;
    const failedTestsFile = path.join(tmpdir(), `failed_tests_${buildUuid}.txt`);
    
    fs.appendFileSync(failedTestsFile, `${testName}\n`);
  }

  /**
   * Get run smart selection setting
   */
  getRunSmartSelection() {
    return this.runSmartSelection;
  }

  /**
   * Get smart selection mode
   */
  getSmartSelectionMode() {
    return this.smartSelectionMode;
  }

  /**
   * Get smart selection source
   */
  getSmartSelectionSource() {
    return this.smartSelectionSource;
  }

  /**
   * Get project name
   */
  getProjectName() {
    return this.projectName;
  }

  /**
   * Get build name
   */
  getBuildName() {
    return this.buildName;
  }

  /**
   * Get build identifier
   */
  getBuildIdentifier() {
    return this.buildIdentifier;
  }

  /**
   * Set build details
   */
  setBuildDetails(projectName, buildName, buildIdentifier) {
    this.projectName = projectName;
    this.buildName = buildName;
    this.buildIdentifier = buildIdentifier;
    this.logger.debug(`[setBuildDetails] Set - projectName: ${this.projectName}, buildName: ${this.buildName}, buildIdentifier: ${this.buildIdentifier}`);
  }

  /**
   * Set run smart selection
   */
  _setRunSmartSelection(enabled, mode, source = null) {
    try {
      this.runSmartSelection = Boolean(enabled);
      this.smartSelectionMode = mode;
      
      // Log the configuration for debugging
      this.logger.debug(`Setting runSmartSelection: enabled=${this.runSmartSelection}, mode=${this.smartSelectionMode}`);
      
      // Normalize source to always be a list of paths
      if (source === null) {
        this.smartSelectionSource = null;
      } else if (Array.isArray(source)) {
        this.smartSelectionSource = source;
      } else if (typeof source === 'string' && source.endsWith('.json')) {
        this.smartSelectionSource = this._loadSourceFromFile(source) || [];
      }
      
      this._setTestOrdering();
    } catch (e) {
      this.logger.error(`[_setRunSmartSelection] ${e}`);
    }
  }

  _loadSourceFromFile(filePath) {
    /**
     * Parse JSON source configuration file and format it for smart selection.
     * 
     * @param {string} filePath - Path to the JSON configuration file
     * @returns {Array} Formatted list of repository configurations
     */
    if (!fs.existsSync(filePath)) {
      this.logger.error(`Source file '${filePath}' does not exist.`);

      return [];
    }

    let data = null;
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      data = JSON.parse(fileContent);
    } catch (error) {
      this.logger.error(`Error parsing JSON from source file '${filePath}': ${error.message}`);

      return [];
    }

    // Cache feature branch mappings from env to avoid repeated parsing
    let featureBranchEnvMap = null;

    const loadFeatureBranchMaps = () => {
      let envMap = {};
      
      try {
        const envVar = process.env.BROWSERSTACK_ORCHESTRATION_SMART_SELECTION_FEATURE_BRANCHES || '';
        
        if (envVar.startsWith('{') && envVar.endsWith('}')) {
          envMap = JSON.parse(envVar);
        } else {
          // Parse comma-separated key:value pairs
          envMap = envVar.split(',')
            .filter(item => item.includes(':'))
            .reduce((acc, item) => {
              const [key, value] = item.split(':');
              if (key && value) {
                acc[key.trim()] = value.trim();
              }

              return acc;
            }, {});
        }
      } catch (error) {
        this.logger.error(`Error parsing feature branch mappings: ${error.message}`);
      }
      
      this.logger.debug(`Feature branch mappings from env: ${JSON.stringify(envMap)}`);

      return envMap;
    };

    if (featureBranchEnvMap === null) {
      featureBranchEnvMap = loadFeatureBranchMaps();
    }

    const getFeatureBranch = (name, repoInfo) => {
      // 1. Check in environment variable map
      if (featureBranchEnvMap[name]) {
        return featureBranchEnvMap[name];
      }
      // 2. Check in repo_info
      if (repoInfo.featureBranch) {
        return repoInfo.featureBranch;
      }

      return null;
    };

    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      const formattedData = [];
      const namePattern = /^[A-Z0-9_]+$/;
      
      for (const [name, repoInfo] of Object.entries(data)) {
        if (typeof repoInfo !== 'object' || repoInfo === null) {
          continue;
        }

        if (!repoInfo.url) {
          this.logger.warn(`Repository URL is missing for source '${name}': ${JSON.stringify(repoInfo)}`);
          continue;
        }

        // Validate name
        if (!namePattern.test(name)) {
          this.logger.warn(`Invalid source identifier format for '${name}': ${JSON.stringify(repoInfo)}`);
          continue;
        }

        // Validate length
        if (name.length > 30 || name.length < 1) {
          this.logger.warn(`Source identifier '${name}' must have a length between 1 and 30 characters.`);
          continue;
        }

        const repoInfoCopy = {...repoInfo};
        repoInfoCopy.name = name;
        repoInfoCopy.featureBranch = getFeatureBranch(name, repoInfo);

        if (!repoInfoCopy.featureBranch) {
          this.logger.warn(`Feature branch not specified for source '${name}': ${JSON.stringify(repoInfo)}`);
          continue;
        }

        if (repoInfoCopy.baseBranch && repoInfoCopy.baseBranch === repoInfoCopy.featureBranch) {
          this.logger.warn(`Feature branch and base branch cannot be the same for source '${name}': ${JSON.stringify(repoInfo)}`);
          continue;
        }

        formattedData.push(repoInfoCopy);
      }
      
      return formattedData;
    }

    return Array.isArray(data) ? data : [];
  }  
  
  /**
   * Set test ordering based on priorities
   */
  _setTestOrdering() {
    if (this.runSmartSelection) { // Highest priority
      this.testOrdering.enable(RUN_SMART_SELECTION);
    } else {
      this.testOrdering.disable();
    }
  }

  /**
   * Check if test ordering is enabled
   */
  testOrderingEnabled() {
    return this.testOrdering.getEnabled();
  }

  /**
   * Get test ordering name
   */
  getTestOrderingName() {
    if (this.testOrdering.getEnabled()) {
      return this.testOrdering.getName();
    }

    return null;
  }

  /**
   * Get test orchestration metadata
   */
  getTestOrchestrationMetadata() {
    const data = {
      'run_smart_selection': {
        'enabled': this.getRunSmartSelection(),
        'mode': this.getSmartSelectionMode(),
        'source': this.getSmartSelectionSource()
      }
    };

    return data;
  }

  /**
   * Get build start data
   */
  getBuildStartData(config) {
    const testOrchestrationData = {};

    testOrchestrationData['run_smart_selection'] = {
      'enabled': this.getRunSmartSelection(),
      'mode': this.getSmartSelectionMode()
      // Not sending "source" to TH builds
    };

    return testOrchestrationData;
  }

  /**
   * Collects build data by making a call to the collect-build-data endpoint
   */
  async collectBuildData(config) {
    const buildUuid = process.env.BS_TESTOPS_BUILD_HASHED_ID;
    this.logger.debug(`[collectBuildData] Collecting build data for build UUID: ${buildUuid}`);

    try {
      const endpoint = `testorchestration/api/v1/builds/${buildUuid}/collect-build-data`;
      
      const payload = {
        projectName: this.getProjectName(),
        buildName: this.getBuildName(),
        buildRunIdentifier: this.getBuildIdentifier(),
        nodeIndex: parseInt(process.env.BROWSERSTACK_NODE_INDEX || '0', 10),
        totalNodes: parseInt(process.env.BROWSERSTACK_TOTAL_NODE_COUNT || '1', 10),
        hostInfo: getHostInfo()
      };

      this.logger.debug(`[collectBuildData] Sending build data payload: ${JSON.stringify(payload)}`);

      const response = await RequestUtils.postCollectBuildData(endpoint, payload);

      if (response) {
        this.logger.debug(`[collectBuildData] Build data collection response: ${JSON.stringify(response)}`);

        return response;
      } 
      this.logger.error(`[collectBuildData] Failed to collect build data for build UUID: ${buildUuid}`);

      return null;
      
    } catch (e) {
      this.logger.error(`[collectBuildData] Exception in collecting build data for build UUID ${buildUuid}: ${e}`);

      return null;
    }
  }
}

module.exports = OrchestrationUtils;