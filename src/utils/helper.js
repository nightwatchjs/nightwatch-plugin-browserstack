const os = require('os');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const {promisify} = require('util');
const gitRepoInfo = require('git-repo-info');
const gitconfig = require('gitconfiglocal');
const pGitconfig = promisify(gitconfig);
const gitLastCommit = require('git-last-commit');
const {makeRequest} = require('./requestHelper');
const {RERUN_FILE, DEFAULT_WAIT_TIMEOUT_FOR_PENDING_UPLOADS, DEFAULT_WAIT_INTERVAL_FOR_PENDING_UPLOADS, consoleHolder} = require('./constants');
const requestQueueHandler = require('./requestQueueHandler');
const Logger = require('./logger');
// const LogPatcher = require('./logPatcher');
// const BSTestOpsPatcher = new LogPatcher({});

// console = {};
// Object.keys(consoleHolder).forEach(method => {
//   console[method] = (...args) => {
//     BSTestOpsPatcher[method](...args);
//   };
// });

exports.debug = (text) => {
  if (process.env.BROWSERSTACK_OBSERVABILITY_DEBUG === 'true' || process.env.BROWSERSTACK_OBSERVABILITY_DEBUG === '1') {
    consoleHolder.log(`\n[${(new Date()).toISOString()}][ OBSERVABILITY ] ${text}\n`);
  }
};

exports.generateLocalIdentifier = () => {
  const formattedDate = new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false})
    .format(new Date())
    .replace(/ |, /g, '_')
    .replace(':', '');
  const hostname = os.hostname();
  const randomChars = Math.random().toString(36).slice(2, 6);

  return `${formattedDate}_${hostname}_${randomChars}`;
};

exports.isUndefined = value => (value === undefined || value === null);

exports.isObject = value => (!this.isUndefined(value) && value.constructor === Object);

exports.isTestObservabilitySession = () => {
  return process.env.BROWSERSTACK_TEST_OBSERVABILITY === 'true';
};

exports.getObservabilityUser = (config, bstackOptions={}) => {
  return process.env.BROWSERSTACK_USERNAME || config.user  || bstackOptions.userName;
};

exports.getObservabilityKey = (config, bstackOptions={}) => {
  return process.env.BROWSERSTACK_ACCESS_KEY || config.key || bstackOptions.accessKey;
};

exports.isAccessibilitySession = () => {
  return process.env.BROWSERSTACK_ACCESSIBILITY === 'true';
};

exports.getProjectName = (options, bstackOptions={}, fromProduct={}) => {
  if (fromProduct.test_observability && options.test_observability && options.test_observability.projectName) {
    return options.test_observability.projectName;
  } else if (fromProduct.accessibility && options.accessibility && options.accessibility.projectName) {
    return options.accessibility.projectName;
  } else if (bstackOptions.projectName) {
    return bstackOptions.projectName;
  }

  return '';
  
};

exports.getBuildName = (options, bstackOptions={}, fromProduct={}) => {
  if (fromProduct.test_observability && options.test_observability && options.test_observability.buildName) {
    return options.test_observability.buildName;
  } else if (fromProduct.accessibility && options.accessibility && options.accessibility.buildName) {
    return options.accessibility.buildName;
  } else if (bstackOptions.buildName) {
    return bstackOptions.buildName;
  }

  return path.basename(path.resolve(process.cwd()));
};

exports.getObservabilityBuildTags = (options, bstackOptions={}) => {
  if (options.test_observability && options.test_observability.buildTag) {
    return options.test_observability.buildTag;
  } else if (bstackOptions.buildTag) {
    return bstackOptions.buildTag;
  }

  return [];
};

exports.getFrameworkName = (testRunner) => {
  if (testRunner && testRunner.type) {
    return `nightwatch-${testRunner.type}`;
  }

  return 'nightwatch-default';
};

exports.getCIVendor = () => {
  var env = process.env;
  // Jenkins
  if ((typeof env.JENKINS_URL === 'string' && env.JENKINS_URL.length > 0) || (typeof env.JENKINS_HOME === 'string' && env.JENKINS_HOME.length > 0)) {
    return 'Jenkins';
  }
  // CircleCI
  if (env.CI === 'true' && env.CIRCLECI === 'true') {
    return 'CircleCI';
  }
  // Travis CI
  if (env.CI === 'true' && env.TRAVIS === 'true') {
    return 'TravisCI';
  }
  // Codeship
  if (env.CI === 'true' && env.CI_NAME === 'codeship') {
    return 'Codeship';
  }
  // Bitbucket
  if (env.BITBUCKET_BRANCH && env.BITBUCKET_COMMIT) {
    return 'Bitbucket';
  }
  // Drone
  if (env.CI === 'true' && env.DRONE === 'true') {
    return 'Drone';
  }
  // Semaphore
  if (env.CI === 'true' && env.SEMAPHORE === 'true') {
    return 'Semaphore';
  }
  // GitLab
  if (env.CI === 'true' && env.GITLAB_CI === 'true') {
    return 'GitLab';
  }
  // Buildkite
  if (env.CI === 'true' && env.BUILDKITE === 'true') {
    return 'Buildkite';
  }
  // Visual Studio Team Services
  if (env.TF_BUILD === 'True') {
    return 'Visual Studio Team Services';
  }
};

exports.getCiInfo = () => {
  var env = process.env;
  const ciVendor = this.getCIVendor();
  switch (ciVendor) {
    case 'Jenkins':
      return {
        name: 'Jenkins',
        build_url: env.BUILD_URL,
        job_name: env.JOB_NAME,
        build_number: env.BUILD_NUMBER
      };
    case 'CircleCI': 
      return {
        name: 'CircleCI',
        build_url: env.CIRCLE_BUILD_URL,
        job_name: env.CIRCLE_JOB,
        build_number: env.CIRCLE_BUILD_NUM
      };
    case 'TravisCI':
      return {
        name: 'Travis CI',
        build_url: env.TRAVIS_BUILD_WEB_URL,
        job_name: env.TRAVIS_JOB_NAME,
        build_number: env.TRAVIS_BUILD_NUMBER
      };
    case 'Codeship':
      return {
        name: 'Codeship',
        build_url: null,
        job_name: null,
        build_number: null
      };
    case 'Bitbucket':
      return {
        name: 'Bitbucket',
        build_url: env.BITBUCKET_GIT_HTTP_ORIGIN,
        job_name: null,
        build_number: env.BITBUCKET_BUILD_NUMBER
      };
    case 'Drone':
      return {
        name: 'Drone',
        build_url: env.DRONE_BUILD_LINK,
        job_name: null,
        build_number: env.DRONE_BUILD_NUMBER
      };
    case 'Semaphore':
      return {
        name: 'Semaphore',
        build_url: env.SEMAPHORE_ORGANIZATION_URL,
        job_name: env.SEMAPHORE_JOB_NAME,
        build_number: env.SEMAPHORE_JOB_ID
      };
    case 'GitLab':
      return {
        name: 'GitLab',
        build_url: env.CI_JOB_URL,
        job_name: env.CI_JOB_NAME,
        build_number: env.CI_JOB_ID
      };
    case 'Buildkite':
      return {
        name: 'Buildkite',
        build_url: env.BUILDKITE_BUILD_URL,
        job_name: env.BUILDKITE_LABEL || env.BUILDKITE_PIPELINE_NAME,
        build_number: env.BUILDKITE_BUILD_NUMBER
      };
    case 'Visual Studio Team Services':
      return {
        name: 'Visual Studio Team Services',
        build_url: `${env.SYSTEM_TEAMFOUNDATIONSERVERURI}${env.SYSTEM_TEAMPROJECTID}`,
        job_name: env.SYSTEM_DEFINITIONID,
        build_number: env.BUILD_BUILDID
      };
    default:
      return null;
  }
};

exports.getHostInfo = () => {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    type: os.type(),
    version: os.version(),
    arch: os.arch()
  };
};

exports.isBrowserstackInfra = () => {
  return process.env.BROWSERSTACK_INFRA === 'true';
};

const findGitConfig = async (filePath) => {
  if (filePath == null || filePath === '' || filePath === '/') {
    return null;
  }
  try {
    await fsPromises.stat(filePath + '/.git/config');

    return filePath;
  } catch (e) {
    const parentFilePath = filePath.split('/');
    parentFilePath.pop();

    return await findGitConfig(parentFilePath.join('/'));
  }
};

exports.getGitMetaData = () => {
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        var info = gitRepoInfo();
        if (!info.commonGitDir) {
          Logger.info('Unable to find a Git directory');

          resolve({});
        } else if (!info.author && await findGitConfig(process.cwd())) {
          /* commit objects are packed */
          gitLastCommit.getLastCommit(async (err, commit) => {
            info['author'] = info['author'] || `${commit['author']['name'].replace(/[“]+/g, '')} <${commit['author']['email'].replace(/[“]+/g, '')}>`;
            info['authorDate'] = info['authorDate'] || commit['authoredOn'];
            info['committer'] = info['committer'] || `${commit['committer']['name'].replace(/[“]+/g, '')} <${commit['committer']['email'].replace(/[“]+/g, '')}>`;
            info['committerDate'] = info['committerDate'] || commit['committedOn'];
            info['commitMessage'] = info['commitMessage'] || commit['subject'];

            const {remote} = await pGitconfig(info.commonGitDir);
            const remotes = Object.keys(remote).map(remoteName =>  ({name: remoteName, url: remote[remoteName]['url']}));

            resolve({
              'name': 'git',
              'sha': info['sha'],
              'short_sha': info['abbreviatedSha'],
              'branch': info['branch'],
              'tag': info['tag'],
              'committer': info['committer'],
              'committer_date': info['committerDate'],
              'author': info['author'],
              'author_date': info['authorDate'],
              'commit_message': info['commitMessage'],
              'root': info['root'],
              'common_git_dir': info['commonGitDir'],
              'worktree_git_dir': info['worktreeGitDir'],
              'last_tag': info['lastTag'],
              'commits_since_last_tag': info['commitsSinceLastTag'],
              'remotes': remotes
            });
          }, {dst: await findGitConfig(process.cwd())});
        } else {
          const {remote} = await pGitconfig(info.commonGitDir);
          const remotes = Object.keys(remote).map(remoteName =>  ({name: remoteName, url: remote[remoteName]['url']}));

          resolve({
            'name': 'git',
            'sha': info['sha'],
            'short_sha': info['abbreviatedSha'],
            'branch': info['branch'],
            'tag': info['tag'],
            'committer': info['committer'],
            'committer_date': info['committerDate'],
            'author': info['author'],
            'author_date': info['authorDate'],
            'commit_message': info['commitMessage'],
            'root': info['root'],
            'common_git_dir': info['commonGitDir'],
            'worktree_git_dir': info['worktreeGitDir'],
            'last_tag': info['lastTag'],
            'commits_since_last_tag': info['commitsSinceLastTag'],
            'remotes': remotes
          });
        }
      } catch (err) {
        Logger.error(`Exception in populating Git metadata with error : ${err}`);
        resolve({});
      }
    })();
  });
};

exports.requireModule = (module) => {
  Logger.info(`Getting ${module} from ${process.cwd()}`);
  const local_path = path.join(process.cwd(), 'node_modules', module);

  return require(local_path);
};

exports.getAgentVersion = () => {
  const _path = path.join(__dirname, '../../package.json');
  if (fs.existsSync(_path)) {return require(_path).version}
};

const packages = {};

exports.getPackageVersion = (package_) => {
  if (packages[package_]) {return packages[package_]}

  return packages[package_] = this.requireModule(`${package_}/package.json`).version;
};

exports.uploadEventData = async (eventData) => {
  const log_tag = {
    ['TestRunStarted']: 'Test_Start_Upload',
    ['TestRunFinished']: 'Test_End_Upload',
    ['TestRunSkipped']: 'Test_Skipped_Upload',
    ['LogCreated']: 'Log_Upload',
    ['HookRunStarted']: 'Hook_Start_Upload',
    ['HookRunFinished']: 'Hook_End_Upload'
  }[eventData.event_type];

  if (process.env.BS_TESTOPS_JWT && process.env.BS_TESTOPS_JWT !== 'null') {
    requestQueueHandler.pending_test_uploads += 1;
  }
  
  if (process.env.BS_TESTOPS_BUILD_COMPLETED === 'true') {
    if (process.env.BS_TESTOPS_JWT === 'null') {
      Logger.info(`EXCEPTION IN ${log_tag} REQUEST TO TEST OBSERVABILITY : missing authentication token`);
      requestQueueHandler.pending_test_uploads = Math.max(0, requestQueueHandler.pending_test_uploads-1);

      return {
        status: 'error',
        message: 'Token/buildID is undefined, build creation might have failed'
      };
    } 
    let data = eventData; 
    let event_api_url = 'api/v1/event';
      
    requestQueueHandler.start();
    const {
      shouldProceed,
      proceedWithData,
      proceedWithUrl
    } = requestQueueHandler.add(eventData);
    if (!shouldProceed) {
      return;
    } else if (proceedWithData) {
      data = proceedWithData;
      event_api_url = proceedWithUrl;
    }

    const config = {
      headers: {
        'Authorization': `Bearer ${process.env.BS_TESTOPS_JWT}`,
        'Content-Type': 'application/json',
        'X-BSTACK-TESTOPS': 'true'
      }
    };
  
    try {
      const response = await makeRequest('POST', event_api_url, data, config);
      if (response.data.error) {
        throw ({message: response.data.error});
      } else {
        requestQueueHandler.pending_test_uploads = Math.max(0, requestQueueHandler.pending_test_uploads - (event_api_url === 'api/v1/event' ? 1 : data.length));

        return {
          status: 'success',
          message: ''
        };
      }
    } catch (error) {
      if (error.response) {
        Logger.error(`EXCEPTION IN ${event_api_url !== requestQueueHandler.eventUrl ? log_tag : 'Batch_Queue'} REQUEST TO TEST OBSERVABILITY : ${error.response.status} ${error.response.statusText} ${JSON.stringify(error.response.data)}`);
      } else {
        Logger.error(`EXCEPTION IN ${event_api_url !== requestQueueHandler.eventUrl ? log_tag : 'Batch_Queue'} REQUEST TO TEST OBSERVABILITY : ${error.message || error}`);
      }
      requestQueueHandler.pending_test_uploads = Math.max(0, requestQueueHandler.pending_test_uploads - (event_api_url === 'api/v1/event' ? 1 : data.length));

      return {
        status: 'error',
        message: error.message || (error.response ? `${error.response.status}:${error.response.statusText}` : error)
      };
    }
  }
};

exports.getAccessKey = (settings) => {
  let accessKey = null;
  if (this.isObject(settings.desiredCapabilities)) {
    if (settings.desiredCapabilities['browserstack.key']) {
      accessKey = settings.desiredCapabilities['browserstack.key'];
    } else if (this.isObject(settings.desiredCapabilities['bstack:options'])) {
      accessKey = settings.desiredCapabilities['bstack:options'].accessKey;
    }
  }

  if (this.isUndefined(accessKey)) {
    accessKey = process.env.BROWSERSTACK_ACCESS_KEY;
  }

  return accessKey;
};

exports.getUserName = (settings) => {
  let userName = null;
  if (this.isObject(settings.desiredCapabilities)) {
    if (settings.desiredCapabilities['browserstack.user']) {
      userName = settings.desiredCapabilities['browserstack.user'];
    } else if (this.isObject(settings.desiredCapabilities['bstack:options'])) {
      userName = settings.desiredCapabilities['bstack:options'].userName;
    }
  }

  if (this.isUndefined(userName)) {
    userName = process.env.BROWSERSTACK_USERNAME;
  }

  return userName;
};

exports.getCloudProvider = (hostname) => {
  if (hostname && hostname.includes('browserstack')) {
    return 'browserstack';
  }

  return 'unknown_grid';
};

exports.getIntegrationsObject = (capabilities, sessionId) => {
  return {
    capabilities: capabilities,
    session_id: sessionId,
    browser: capabilities.browserName,
    browser_version: capabilities.browserVersion,
    platform: capabilities.platformName
  };
};

exports.handleNightwatchRerun = async (specs) => {
  const modules = {};
  specs.forEach(spec => {
    modules[spec] = {
      modulePath: spec,
      status: 'fail'
    };
  });
  const data = {
    modules: modules
  };
  try {
    await fsPromises.writeFile(RERUN_FILE, JSON.stringify(data));
    process.env.NIGHTWATCH_RERUN_FAILED = true;
    process.env.NIGHTWATCH_RERUN_REPORT_FILE = path.resolve(RERUN_FILE);
  } catch (error) {
    Logger.error(error);
  }
};

exports.deleteRerunFile = async () => {
  try {
    await fsPromises.unlink(path.resolve(RERUN_FILE));
  } catch (err) {
    Logger.error(err);
  }
};

const sleep = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

exports.uploadPending = async (
  waitTimeout = DEFAULT_WAIT_TIMEOUT_FOR_PENDING_UPLOADS,
  waitInterval = DEFAULT_WAIT_INTERVAL_FOR_PENDING_UPLOADS 
) => {
  if (requestQueueHandler.pending_test_uploads <= 0 || waitTimeout <= 0) {
    return;
  }

  await sleep(waitInterval);

  return this.uploadPending(waitTimeout - waitInterval);
};

exports.shutDownRequestHandler = async () => {
  await requestQueueHandler.shutdown();
};

exports.getScenarioExamples = (gherkinDocument, scenario) => {
  if ((scenario.astNodeIds && scenario.astNodeIds.length <= 1) || scenario.astNodeIds === undefined) {
    return;
  }

  const pickleId = scenario.astNodeIds[0];
  const examplesId = scenario.astNodeIds[1];
  const gherkinDocumentChildren = gherkinDocument.feature?.children;

  let examples = [];

  gherkinDocumentChildren?.forEach(child => {
    if (child.rule) {
      child.rule.children.forEach(childLevel2 => {
        if (childLevel2.scenario && childLevel2.scenario.id === pickleId && childLevel2.scenario.examples) {
          const passedExamples = childLevel2.scenario.examples.flatMap((val) => (val.tableBody)).find((item) => item.id === examplesId)?.cells.map((val) => (val.value));
          if (passedExamples) {
            examples = passedExamples;
          }
        }
      });
    } else if (child.scenario && child.scenario.id === pickleId && child.scenario.examples) {
      const passedExamples = child.scenario.examples.flatMap((val) => (val.tableBody)).find((item) => item.id === examplesId)?.cells.map((val) => (val.value));
      if (passedExamples) {
        examples = passedExamples;
      }
    }
  });

  if (examples.length) {
    return examples;
  }

  return;
};

exports.isCucumberTestSuite = (settings) => {
  return settings?.test_runner?.type === 'cucumber';
};

exports.getPlatformVersion = (driver) => {
  let platformVersion = null;
  try {
    let caps = driver.desiredCapabilities || {};
    if (!this.isUndefined(caps['bstack:options']) && !this.isUndefined(caps['bstack:options']['osVersion'])){
      platformVersion = caps['bstack:options']['osVersion'];
    } else if (!this.isUndefined(caps['os_version'])){
      platformVersion = caps['os_version'];
    }
  } catch (err) {
    Logger.error(`Unable to fetch platform Version : ${err}`);
  }

  return platformVersion;
};
