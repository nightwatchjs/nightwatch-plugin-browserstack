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
const {RERUN_FILE, DEFAULT_WAIT_TIMEOUT_FOR_PENDING_UPLOADS, DEFAULT_WAIT_INTERVAL_FOR_PENDING_UPLOADS, consoleHolder,
  MAX_GIT_META_DATA_SIZE_IN_BYTES, GIT_META_DATA_TRUNCATED} = require('./constants');
const requestQueueHandler = require('./requestQueueHandler');
const Logger = require('./logger');
const LogPatcher = require('./logPatcher');
const BSTestOpsPatcher = new LogPatcher({});
const sessions = {};
const {execSync} = require('child_process');

console = {};
Object.keys(consoleHolder).forEach(method => {
  console[method] = (...args) => {
    try {
      if (!Object.keys(BSTestOpsPatcher).includes(method)) {
        consoleHolder[method](...args);
      } else {
        BSTestOpsPatcher[method](...args);
      }
    } catch (error) {
      consoleHolder[method](...args);
    }
  };
});

exports.debug = (text) => {
  if (process.env.BROWSERSTACK_OBSERVABILITY_DEBUG === 'true' || process.env.BROWSERSTACK_OBSERVABILITY_DEBUG === '1' ||
      process.env.BROWSERSTACK_TEST_REPORTING_DEBUG === 'true' || process.env.BROWSERSTACK_TEST_REPORTING_DEBUG === '1') {
    consoleHolder.log(`\n[${(new Date()).toISOString()}][ TEST REPORTING AND ANALYTICS ] ${text}\n`);
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
  return process.env.BROWSERSTACK_TEST_OBSERVABILITY === 'true' || 
         process.env.BROWSERSTACK_TEST_REPORTING === 'true';
};

exports.getObservabilityUser = (config, bstackOptions={}) => {
  return process.env.BROWSERSTACK_USERNAME || config?.user  || bstackOptions?.userName;
};

exports.getObservabilityKey = (config, bstackOptions={}) => {
  return process.env.BROWSERSTACK_ACCESS_KEY || config?.key || bstackOptions?.accessKey;
};

exports.isAccessibilitySession = () => {
  return process.env.BROWSERSTACK_ACCESSIBILITY === 'true';
};

exports.isAccessibilityEnabled = (settings) => {
   if (process.argv.includes('--disable-accessibility'))
    return false;
   else
    return settings['@nightwatch/browserstack']?.accessibility === true;
};

exports.getProjectName = (options, bstackOptions={}, fromProduct={}) => {
  if ((fromProduct.test_observability || fromProduct.test_reporting) && 
      ((options.test_observability && options.test_observability.projectName) ||
       (options.test_reporting && options.test_reporting.projectName))) {
    return options.test_observability?.projectName || options.test_reporting?.projectName;
  } else if (fromProduct.accessibility && options.accessibility && options.accessibility.projectName) {
    return options.accessibility.projectName;
  } else if (bstackOptions.projectName) {
    return bstackOptions.projectName;
  }

  return '';

};

exports.getBuildName = (options, bstackOptions={}, fromProduct={}) => {
  if ((fromProduct.test_observability || fromProduct.test_reporting) && 
      ((options.test_observability && options.test_observability.buildName) ||
       (options.test_reporting && options.test_reporting.buildName))) {
    return options.test_observability?.buildName || options.test_reporting?.buildName;
  } else if (fromProduct.accessibility && options.accessibility && options.accessibility.buildName) {
    return options.accessibility.buildName;
  } else if (bstackOptions.buildName) {
    return bstackOptions.buildName;
  }

  return path.basename(path.resolve(process.cwd()));
};

exports.getObservabilityBuildTags = (options, bstackOptions={}) => {
  if ((options.test_observability && options.test_observability.buildTag) ||
      (options.test_reporting && options.test_reporting.buildTag)) {
    return options.test_observability?.buildTag || options.test_reporting?.buildTag;
  } else if (bstackOptions.buildTag) {
    return bstackOptions.buildTag;
  }
  
  // Support new environment variable
  if (process.env.TEST_REPORTING_BUILD_TAG) {
    return process.env.TEST_REPORTING_BUILD_TAG.split(',').map(tag => tag.trim());
  }

  return [];
};

exports.getFrameworkName = (testRunner) => {
  if (testRunner && testRunner.type) {
    return `nightwatch-${testRunner.type}`;
  }

  return 'nightwatch-default';
};

exports.isTrue = (value) => (value+ '').toLowerCase() === 'true';

exports.getCIVendor = () => {
  const ciInfo = this.getCiInfo();
  if (ciInfo) {
    return ciInfo.name;
  }

  return null;
};

exports.getCiInfo = () => {
  const env = process.env;
  // Jenkins
  if ((typeof env.JENKINS_URL === 'string' && env.JENKINS_URL.length > 0) || (typeof env.JENKINS_HOME === 'string' && env.JENKINS_HOME.length > 0)) {
    return {
      name: 'Jenkins',
      build_url: env.BUILD_URL,
      job_name: env.JOB_NAME,
      build_number: env.BUILD_NUMBER
    };
  }
  // CircleCI
  if (this.isTrue(env.CI) && this.isTrue(env.CIRCLECI)) {
    return {
      name: 'CircleCI',
      build_url: env.CIRCLE_BUILD_URL,
      job_name: env.CIRCLE_JOB,
      build_number: env.CIRCLE_BUILD_NUM
    };
  }
  // Travis CI
  if (this.isTrue(env.CI) && this.isTrue(env.TRAVIS)) {
    return {
      name: 'Travis CI',
      build_url: env.TRAVIS_BUILD_WEB_URL,
      job_name: env.TRAVIS_JOB_NAME,
      build_number: env.TRAVIS_BUILD_NUMBER
    };
  }
  // Codeship
  if (this.isTrue(env.CI) && this.isTrue(env.CI_NAME)) {
    return {
      name: 'Codeship',
      build_url: null,
      job_name: null,
      build_number: null
    };
  }
  // Bitbucket
  if (env.BITBUCKET_BRANCH && env.BITBUCKET_COMMIT) {
    return {
      name: 'Bitbucket',
      build_url: env.BITBUCKET_GIT_HTTP_ORIGIN,
      job_name: null,
      build_number: env.BITBUCKET_BUILD_NUMBER
    };
  }
  // Drone
  if (this.isTrue(env.CI) && this.isTrue(env.DRONE)) {
    return {
      name: 'Drone',
      build_url: env.DRONE_BUILD_LINK,
      job_name: null,
      build_number: env.DRONE_BUILD_NUMBER
    };
  }
  // Semaphore
  if (this.isTrue(env.CI) && this.isTrue(env.SEMAPHORE)) {
    return {
      name: 'Semaphore',
      build_url: env.SEMAPHORE_ORGANIZATION_URL,
      job_name: env.SEMAPHORE_JOB_NAME,
      build_number: env.SEMAPHORE_JOB_ID
    };
  }
  // GitLab
  if (this.isTrue(env.CI) && this.isTrue(env.GITLAB_CI)) {
    return {
      name: 'GitLab',
      build_url: env.CI_JOB_URL,
      job_name: env.CI_JOB_NAME,
      build_number: env.CI_JOB_ID
    };
  }
  // Buildkite
  if (this.isTrue(env.CI) && this.isTrue(env.BUILDKITE)) {
    return {
      name: 'Buildkite',
      build_url: env.BUILDKITE_BUILD_URL,
      job_name: env.BUILDKITE_LABEL || env.BUILDKITE_PIPELINE_NAME,
      build_number: env.BUILDKITE_BUILD_NUMBER
    };
  }
  // Visual Studio Team Services
  if (this.isTrue(env.TF_BUILD)) {
    return {
      name: 'Visual Studio Team Services',
      build_url: `${env.SYSTEM_TEAMFOUNDATIONSERVERURI}${env.SYSTEM_TEAMPROJECTID}`,
      job_name: env.SYSTEM_DEFINITIONID,
      build_number: env.BUILD_BUILDID
    };
  }
  // Appveyor
  if (this.isTrue(env.APPVEYOR)) {
    return {
      name: 'Appveyor',
      build_url: `${env.APPVEYOR_URL}/project/${env.APPVEYOR_ACCOUNT_NAME}/${env.APPVEYOR_PROJECT_SLUG}/builds/${env.APPVEYOR_BUILD_ID}`,
      job_name: env.APPVEYOR_JOB_NAME,
      build_number: env.APPVEYOR_BUILD_NUMBER
    };
  }
  // Azure CI
  if (env.AZURE_HTTP_USER_AGENT && env.TF_BUILD) {
    return {
      name: 'Azure CI',
      build_url: `${env.SYSTEM_TEAMFOUNDATIONSERVERURI}${env.SYSTEM_TEAMPROJECT}/_build/results?buildId=${env.BUILD_BUILDID}`,
      job_name: env.BUILD_BUILDID,
      build_number: env.BUILD_BUILDID
    };
  }
  // AWS CodeBuild
  if (env.CODEBUILD_BUILD_ID || env.CODEBUILD_RESOLVED_SOURCE_VERSION || env.CODEBUILD_SOURCE_VERSION) {
    return {
      name: 'AWS CodeBuild',
      build_url: env.CODEBUILD_PUBLIC_BUILD_URL,
      job_name: env.CODEBUILD_BUILD_ID,
      build_number: env.CODEBUILD_BUILD_ID
    };
  }
  // Bamboo
  if (env.bamboo_buildNumber) {
    return {
      name: 'Bamboo',
      build_url: env.bamboo_buildResultsUrl,
      job_name: env.bamboo_shortJobName,
      build_number: env.bamboo_buildNumber
    };
  }
  // Wercker
  if (env.WERCKER || env.WERCKER_MAIN_PIPELINE_STARTED) {
    return {
      name: 'Wercker',
      build_url: env.WERCKER_BUILD_URL,
      job_name: env.WERCKER_MAIN_PIPELINE_STARTED ? 'Main Pipeline' : null,
      build_number: env.WERCKER_GIT_COMMIT
    };
  }
  // Google Cloud
  if (env.GCP_PROJECT || env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT) {
    return {
      name: 'Google Cloud',
      build_url: null,
      job_name: env.PROJECT_ID,
      build_number: env.BUILD_ID
    };
  }
  // Shippable
  if (env.SHIPPABLE) {
    return {
      name: 'Shippable',
      build_url: env.SHIPPABLE_BUILD_URL,
      job_name: env.SHIPPABLE_JOB_ID ? `Job #${env.SHIPPABLE_JOB_ID}` : null,
      build_number: env.SHIPPABLE_BUILD_NUMBER
    };
  }
  // Netlify
  if (this.isTrue(env.NETLIFY)) {
    return {
      name: 'Netlify',
      build_url: env.DEPLOY_URL,
      job_name: env.SITE_NAME,
      build_number: env.BUILD_ID
    };
  }
  // Github Actions
  if (this.isTrue(env.GITHUB_ACTIONS)) {
    return {
      name: 'GitHub Actions',
      build_url: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
      job_name: env.GITHUB_WORKFLOW,
      build_number: env.GITHUB_RUN_ID
    };
  }
  // Vercel
  if (this.isTrue(env.CI) && env.VERCEL === '1') {
    return {
      name: 'Vercel',
      build_url: `http://${env.VERCEL_URL}`,
      job_name: null,
      build_number: null
    };
  }
  // Teamcity
  if (env.TEAMCITY_VERSION) {
    return {
      name: 'Teamcity',
      build_url: null,
      job_name: null,
      build_number: env.BUILD_NUMBER
    };
  }
  // Concourse
  if (env.CONCOURSE || env.CONCOURSE_URL || env.CONCOURSE_USERNAME || env.CONCOURSE_TEAM) {
    return {
      name: 'Concourse',
      build_url: null,
      job_name: env.BUILD_JOB_NAME || null,
      build_number: env.BUILD_ID || null
    };
  }
  // GoCD
  if (env.GO_JOB_NAME) {
    return {
      name: 'GoCD',
      build_url: null,
      job_name: env.GO_JOB_NAME,
      build_number: env.GO_PIPELINE_COUNTER
    };
  }
  // CodeFresh
  if (env.CF_BUILD_ID) {
    return {
      name: 'CodeFresh',
      build_url: env.CF_BUILD_URL,
      job_name: env.CF_PIPELINE_NAME,
      build_number: env.CF_BUILD_ID
    };
  }
  // if no matches, return null

  return {
    name: null,
    build_number: null
  };
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

exports.isBrowserstackInfra = (settings) => {
  const isBrowserstackInfra = settings && settings.webdriver && settings.webdriver.host && settings.webdriver.host.indexOf('browserstack') === -1 ? false : true;
  return isBrowserstackInfra;
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

            let gitMetaData = {
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
            };

            gitMetaData = exports.checkAndTruncateVCSInfo(gitMetaData);

            resolve(gitMetaData);
          }, {dst: await findGitConfig(process.cwd())});
        } else {
          const {remote} = await pGitconfig(info.commonGitDir);
          const remotes = Object.keys(remote).map(remoteName =>  ({name: remoteName, url: remote[remoteName]['url']}));

          let gitMetaData = {
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
          };

          gitMetaData = exports.checkAndTruncateVCSInfo(gitMetaData);

          resolve(gitMetaData);
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

  if (process.env.BROWSERSTACK_TESTHUB_JWT && process.env.BROWSERSTACK_TESTHUB_JWT !== 'null') {
    requestQueueHandler.pending_test_uploads += 1;
  }

  if (process.env.BS_TESTOPS_BUILD_COMPLETED === 'true') {
    if (process.env.BROWSERSTACK_TESTHUB_JWT === 'null') {
      Logger.info(`EXCEPTION IN ${log_tag} REQUEST TO TEST REPORTING AND ANALYTICS : missing authentication token`);
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
        'Authorization': `Bearer ${process.env.BROWSERSTACK_TESTHUB_JWT}`,
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
        Logger.error(`EXCEPTION IN ${event_api_url !== requestQueueHandler.eventUrl ? log_tag : 'Batch_Queue'} REQUEST TO TEST REPORTING AND ANALYTICS : ${error.response.status} ${error.response.statusText} ${JSON.stringify(error.response.data)}`);
      } else {
        Logger.error(`EXCEPTION IN ${event_api_url !== requestQueueHandler.eventUrl ? log_tag : 'Batch_Queue'} REQUEST TO TEST REPORTING AND ANALYTICS : ${error.message || error}`);
      }
      requestQueueHandler.pending_test_uploads = Math.max(0, requestQueueHandler.pending_test_uploads - (event_api_url === 'api/v1/event' ? 1 : data.length));

      return {
        status: 'error',
        message: error.message || (error.response ? `${error.response.status}:${error.response.statusText}` : error)
      };
    }
  }
};

exports.getAccessKey = (settings, nwConfig) => {
  let accessKey = process.env.BROWSERSTACK_ACCESS_KEY || nwConfig?.accessKey;
  if (!this.isUndefined(accessKey)) {
    return accessKey;
  }

  if (this.isObject(settings.desiredCapabilities)) {
    if (settings.desiredCapabilities['browserstack.key']) {
      accessKey = settings.desiredCapabilities['browserstack.key'];
    } else if (this.isObject(settings.desiredCapabilities['bstack:options'])) {
      accessKey = settings.desiredCapabilities['bstack:options'].accessKey;
    }
  }

  return accessKey;
};

exports.getUserName = (settings, nwConfig) => {
  let userName = process.env.BROWSERSTACK_USERNAME || nwConfig?.userName;
  if (!this.isUndefined(userName)) {
    return userName;
  }

  if (this.isObject(settings.desiredCapabilities)) {
    if (settings.desiredCapabilities['browserstack.user']) {
      userName = settings.desiredCapabilities['browserstack.user'];
    } else if (this.isObject(settings.desiredCapabilities['bstack:options'])) {
      userName = settings.desiredCapabilities['bstack:options'].userName;
    }
  }

  return userName;
};

exports.getCloudProvider = (hostname) => {
  if (hostname && hostname.includes('browserstack')) {
    return 'browserstack';
  }

  return 'unknown_grid';
};

exports.getObservabilityLinkedProductName = (caps, hostname) => {
  let product = undefined;

  if (hostname) {
    if (hostname.includes('browserstack.com') && !hostname.includes('hub-ft')) {
      if (this.isUndefined(caps.browserName)) {
        product = 'app-automate';
      } else {
        product = 'automate';
      }
    } else if (hostname.includes('browserstack-ats.com') || hostname.includes('hub-ft') || hostname.includes('browserstack-turboscale-grid')) {
      product = 'turboscale';
    }
  }

  return product;
};

exports.getIntegrationsObject = (capabilities, sessionId, hostname, platform_version) => {
  return {
    capabilities: capabilities,
    session_id: sessionId,
    browser: capabilities.browserName,
    browser_version: capabilities.browserVersion,
    platform: capabilities.platformName,
    platform_version: platform_version,
    product: this.getObservabilityLinkedProductName(capabilities, hostname)
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
  if (!(scenario.astNodeIds?.length > 1)) {
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
  return settings?.test_runner?.type === 'cucumber' || exports.isTrue(process.env.CUCUMBER_SUITE);
};

exports.getPlatformVersion = (driver) => {
  let platformVersion = null;
  try {
    const caps = driver.desiredCapabilities || {};
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

exports.generateCapabilityDetails = (args) => {
  if (!this.isUndefined(browser)) {
    return {
      host: browser.options.webdriver.host,
      port: browser.options.webdriver.port,
      capabilities: browser.capabilities,
      sessionId: browser.sessionId,
      testCaseStartedId: args.envelope.testCaseStartedId
    };
  }
  if (sessions[args.envelope.testCaseStartedId]) {
    return sessions[args.envelope.testCaseStartedId];
  }
};

exports.storeSessionsData = (data) => {
  if (data.POST_SESSION_EVENT) {
    const sessionDetails = JSON.parse(data.POST_SESSION_EVENT);
    if (!sessionDetails.session) {
      return;
    }
    if (!Object.keys(sessions).includes(sessionDetails.session.testCaseStartedId)) {
      sessions[sessionDetails.session.testCaseStartedId] = sessionDetails.session;
    }
  } else {
    if (!data.report.session) {
      return;
    }
    
    Object.keys(data.report.session).forEach(key => {
      if (!Object.keys(sessions).includes(key)) {
        sessions[key] = data.report.session[key];
      }
    });
  }
};

exports.deepClone = (obj) => {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(exports.deepClone);
  }

  const cloned = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = exports.deepClone(obj[key]);
    }
  }

  return cloned;
};

exports.shouldSendLogs = () => {
  return exports.isTestObservabilitySession() && exports.isCucumberTestSuite();
};

exports.checkAndTruncateVCSInfo = (gitMetaData) => {
  const gitMetaDataSizeInBytes = exports.getSizeOfJsonObjectInBytes(gitMetaData);

  if (gitMetaDataSizeInBytes && gitMetaDataSizeInBytes > MAX_GIT_META_DATA_SIZE_IN_BYTES) {
    const truncateSize = gitMetaDataSizeInBytes - MAX_GIT_META_DATA_SIZE_IN_BYTES;
    const truncatedCommitMessage = exports.truncateString(gitMetaData.commit_message, truncateSize);
    gitMetaData.commit_message = truncatedCommitMessage;
    Logger.info(`The commit has been truncated. Size of commit after truncation is ${ exports.getSizeOfJsonObjectInBytes(gitMetaData) /1024 } KB`);
  }

  return gitMetaData;
};

exports.getSizeOfJsonObjectInBytes = (jsonData) => {
  try {
    if (jsonData && jsonData instanceof Object) {
      const buffer = Buffer.from(JSON.stringify(jsonData));

      return buffer.length;
    }
  } catch (error) {
    Logger.debug(`Something went wrong while calculating size of JSON object: ${error}`);
  }

  return -1;
};

exports.truncateString = (field, truncateSizeInBytes) => {
  try {
    const bufferSizeInBytes = Buffer.from(GIT_META_DATA_TRUNCATED).length;

    const fieldBufferObj = Buffer.from(field);
    const lenOfFieldBufferObj = fieldBufferObj.length;
    const finalLen = Math.ceil(lenOfFieldBufferObj - truncateSizeInBytes - bufferSizeInBytes);
    if (finalLen > 0) {
      const truncatedString = fieldBufferObj.subarray(0, finalLen).toString() + GIT_META_DATA_TRUNCATED;

      return truncatedString;
    }
  } catch (error) {
    Logger.debug(`Error while truncating field, nothing was truncated here: ${error}`);
  }

  return field;
};

// Helper function to check if a pattern contains glob characters
exports.isGlobPattern = (pattern) => {
  return pattern.includes('*') || pattern.includes('?') || pattern.includes('[');
};

// Helper function to recursively find files matching a pattern
exports.findFilesRecursively = (dir, pattern) => {
  const files = [];
  try {
    if (!fs.existsSync(dir)) {
      return files;
    }
    
    const entries = fs.readdirSync(dir, {withFileTypes: true});
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // Recursively search subdirectories
        files.push(...exports.findFilesRecursively(fullPath, pattern));
      } else if (entry.isFile()) {
        const relativePath = path.relative(process.cwd(), fullPath);
        
        // Enhanced pattern matching for glob patterns
        if (exports.matchesGlobPattern(relativePath, pattern)) {
          files.push(relativePath);
        }
      }
    }
  } catch (err) {
    Logger.debug(`Error reading directory ${dir}: ${err.message}`);
  }
  
  return files;
};

// Helper function to match a file path against a glob pattern
exports.matchesGlobPattern = (filePath, pattern) => {
  // Normalize paths to use forward slashes
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');
  
  // Convert glob pattern to regex step by step
  let regexPattern = normalizedPattern;
  
  // First, handle ** patterns (must be done before single *)
  // ** should match zero or more directories
  regexPattern = regexPattern.replace(/\*\*/g, '§DOUBLESTAR§');
  
  // Escape regex special characters except the placeholders
  regexPattern = regexPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  
  // Now handle single * and ? patterns
  regexPattern = regexPattern.replace(/\*/g, '[^/]*'); // * matches anything except path separators
  regexPattern = regexPattern.replace(/\?/g, '[^/]'); // ? matches single character except path separator
  
  // Finally, replace ** placeholder with regex for any path (including zero directories)
  regexPattern = regexPattern.replace(/§DOUBLESTAR§/g, '.*?');
  
  // Special case: if pattern ends with /**/* we need to handle direct files in the base directory
  // Convert patterns like "dir/**/*" to also match "dir/*"
  if (normalizedPattern.includes('/**/')) {
    const baseRegex = regexPattern;
    const alternativeRegex = regexPattern.replace(/\/\.\*\?\//g, '/');
    regexPattern = `(?:${baseRegex}|${alternativeRegex})`;
  }
  
  // Ensure pattern matches from start to end
  regexPattern = '^' + regexPattern + '$';
  
  try {
    const regex = new RegExp(regexPattern);

    return regex.test(normalizedPath);
  } catch (err) {
    Logger.debug(`Error in glob pattern matching: ${err.message}`);

    return false;
  }
};

// Helper function to resolve and collect test files from a path/pattern
exports.collectTestFiles = (testPath, source = 'unknown') => {
  try {
    Logger.debug(`Collecting test files from ${source}: ${testPath}`);
    
    // Check if it's a glob pattern
    if (exports.isGlobPattern(testPath)) {
      Logger.debug(`Processing glob pattern: ${testPath}`);

      return exports.expandGlobPattern(testPath);
    }
    
    // Handle regular path
    const resolvedPath = path.resolve(testPath);
    
    // Check if path exists
    if (fs.existsSync(resolvedPath)) {
      const stats = fs.statSync(resolvedPath);
      
      if (stats.isFile()) {
        const relativePath = path.relative(process.cwd(), resolvedPath);
        Logger.debug(`Found test file: ${relativePath}`);

        return [relativePath];
      } else if (stats.isDirectory()) {
        // For directories, find all supported test files
        const files = exports.findTestFilesInDirectory(resolvedPath);
        Logger.debug(`Found ${files.length} test files in directory: ${testPath}`);

        return files;
      }
    } else {
      Logger.debug(`Path does not exist: ${testPath}`);
    }
  } catch (err) {
    Logger.debug(`Could not collect test files from ${testPath} (${source}): ${err.message}`);
  }

  return [];
};

// Helper function to find test files in a directory
exports.findTestFilesInDirectory = (dir) => {
  const files = [];
  const supportedExtensions = ['.js', '.feature'];
  
  try {
    const entries = fs.readdirSync(dir, {recursive: true});
    
    for (const entry of entries) {
      if (typeof entry === 'string') {
        const fullPath = path.join(dir, entry);
        const ext = path.extname(entry);
        
        if (supportedExtensions.includes(ext) && fs.statSync(fullPath).isFile()) {
          const relativePath = path.relative(process.cwd(), fullPath);
          files.push(relativePath);
        }
      }
    }
  } catch (err) {
    Logger.debug(`Error reading directory ${dir}: ${err.message}`);
  }
  
  return files;
};

// Helper function to expand glob patterns
exports.expandGlobPattern = (pattern) => {
  Logger.debug(`Expanding glob pattern: ${pattern}`);
  
  // Extract the base directory from the pattern
  const parts = pattern.split(/[/\\]/);
  let baseDir = '.';
  let patternStart = 0;
  
  // Find the first part that contains glob characters
  for (let i = 0; i < parts.length; i++) {
    if (exports.isGlobPattern(parts[i])) {
      patternStart = i;
      break;
    }
    if (i === 0 && parts[i] !== '.') {
      baseDir = parts[i];
    } else if (i > 0) {
      baseDir = path.join(baseDir, parts[i]);
    }
  }
  
  // If baseDir doesn't exist, try current directory
  if (!fs.existsSync(baseDir)) {
    Logger.debug(`Base directory ${baseDir} doesn't exist, using current directory`);
    baseDir = '.';
  }
  
  Logger.debug(`Base directory: ${baseDir}, Pattern: ${pattern}`);
  
  const files = exports.findFilesRecursively(baseDir, pattern);
  Logger.debug(`Found ${files.length} files matching pattern: ${pattern}`);
  
  return files;
};

/**
 * Check if a git metadata result is valid
 */
function isValidGitResult(result) {
  return (
    Array.isArray(result.filesChanged) &&
    result.filesChanged.length > 0 &&
    Array.isArray(result.authors) &&
    result.authors.length > 0
  );
}

/**
 * Get base branch from repository
 */
function getBaseBranch() {
  try {
    // Try to get the default branch from origin/HEAD symbolic ref (works for most providers)
    try {
      const originHeadOutput = execSync('git symbolic-ref refs/remotes/origin/HEAD').toString().trim();
      if (originHeadOutput.startsWith('refs/remotes/origin/')) {
        return originHeadOutput.replace('refs/remotes/', '');
      }
    } catch (e) {
      // Symbolic ref might not exist
    }
    
    // Fallback: use the first branch in local heads
    try {
      const branchesOutput = execSync('git branch').toString().trim();
      const branches = branchesOutput.split('\n').filter(Boolean);
      if (branches.length > 0) {
        // Remove the '* ' from current branch if present and return first branch
        const firstBranch = branches[0].replace(/^\*\s+/, '').trim();

        return firstBranch;
      }
    } catch (e) {
      // Branches might not exist
    }
    
    // Fallback: use the first remote branch if available
    try {
      const remoteBranchesOutput = execSync('git branch -r').toString().trim();
      const remoteBranches = remoteBranchesOutput.split('\n').filter(Boolean);
      for (const branch of remoteBranches) {
        const cleanBranch = branch.trim();
        if (cleanBranch.startsWith('origin/') && !cleanBranch.includes('HEAD')) {
          return cleanBranch;
        }
      }
    } catch (e) {
      // Remote branches might not exist
    }
  } catch (e) {
    Logger.debug(`Error finding base branch: ${e}`);
  }
  
  return null;
}

/**
 * Get changed files from commits
 */
function getChangedFilesFromCommits(commitHashes) {
  const changedFiles = new Set();
  
  try {
    for (const commit of commitHashes) {
      try {
        // Check if commit has parents
        const parentsOutput = execSync(`git log -1 --pretty=%P ${commit}`).toString().trim();
        const parents = parentsOutput.split(' ').filter(Boolean);
        
        for (const parent of parents) {
          const diffOutput = execSync(`git diff --name-only ${parent} ${commit}`).toString().trim();
          const files = diffOutput.split('\n').filter(Boolean);
          
          for (const file of files) {
            changedFiles.add(file);
          }
        }
      } catch (e) {
        Logger.debug(`Error processing commit ${commit}: ${e}`);
      }
    }
  } catch (e) {
    Logger.debug(`Error getting changed files from commits: ${e}`);
  }
  
  return Array.from(changedFiles);
}

/**
 * Get Git metadata for AI selection
 * @param multiRepoSource Array of repository paths for multi-repo setup
 */
exports.getGitMetadataForAiSelection = (folders = []) => {
  
  if (folders && folders.length === 0) {
    return [];
  }
  if (folders === null){
    folders = [process.cwd()];
  }
  
  const results = [];
  
  for (const folder of folders) {
    const originalDir = process.cwd();
    try {
      // Initialize the result structure
      const result = {
        prId: '',
        filesChanged: [],
        authors: [],
        prDate: '',
        commitMessages: [],
        prTitle: '',
        prDescription: '',
        prRawDiff: ''
      };
      
      // Change directory to the folder
      process.chdir(folder);
      
      // Get current branch and latest commit
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
      const latestCommit = execSync('git rev-parse HEAD').toString().trim();
      result.prId = latestCommit;
      
      // Find base branch
      const baseBranch = getBaseBranch();
      Logger.debug(`Base branch for comparison: ${baseBranch}`);
      
      let commits = [];
      
      if (baseBranch) {
        try {
          // Get changed files between base branch and current branch
          const changedFilesOutput = execSync(`git diff --name-only ${baseBranch}...${currentBranch}`).toString().trim();
          Logger.debug(`Changed files between ${baseBranch} and ${currentBranch}: ${changedFilesOutput}`);
          result.filesChanged = changedFilesOutput.split('\n').filter(f => f.trim());
          
          // Get commits between base branch and current branch
          const commitsOutput = execSync(`git log ${baseBranch}..${currentBranch} --pretty=%H`).toString().trim();
          commits = commitsOutput.split('\n').filter(Boolean);
        } catch (e) {
          Logger.debug('Failed to get changed files from branch comparison. Falling back to recent commits.');
          // Fallback to recent commits
          const recentCommitsOutput = execSync('git log -10 --pretty=%H').toString().trim();
          commits = recentCommitsOutput.split('\n').filter(Boolean);
          
          if (commits.length > 0) {
            result.filesChanged = getChangedFilesFromCommits(commits.slice(0, 5));
          }
        }
      } else {
        // Fallback to recent commits
        const recentCommitsOutput = execSync('git log -10 --pretty=%H').toString().trim();
        commits = recentCommitsOutput.split('\n').filter(Boolean);
        
        if (commits.length > 0) {
          result.filesChanged = getChangedFilesFromCommits(commits.slice(0, 5));
        }
      }
      
      // Process commit authors and messages
      const authorsSet = new Set();
      const commitMessages = [];
      
      // Only process commits if we have them
      if (commits.length > 0) {
        for (const commit of commits) {
          try {
            const commitMessage = execSync(`git log -1 --pretty=%B ${commit}`).toString().trim();
            Logger.debug(`Processing commit: ${commitMessage}`);
            
            const authorName = execSync(`git log -1 --pretty=%an ${commit}`).toString().trim();
            authorsSet.add(authorName || 'Unknown');
            
            commitMessages.push({
              message: commitMessage.trim(),
              user: authorName || 'Unknown'
            });
          } catch (e) {
            Logger.debug(`Error processing commit ${commit}: ${e}`);
          }
        }
      }
      
      // If we have no commits but have changed files, add a fallback author
      if (commits.length === 0 && result.filesChanged.length > 0) {
        try {
          // Try to get current git user as fallback
          const fallbackAuthor = execSync('git config user.name').toString().trim() || 'Unknown';
          authorsSet.add(fallbackAuthor);
          Logger.debug(`Added fallback author: ${fallbackAuthor}`);
        } catch (e) {
          authorsSet.add('Unknown');
          Logger.debug('Added Unknown as fallback author');
        }
      }
      
      result.authors = Array.from(authorsSet);
      result.commitMessages = commitMessages;
      
      // Get commit date
      if (latestCommit) {
        const commitDate = execSync(`git log -1 --pretty=%cd --date=format:'%Y-%m-%d' ${latestCommit}`).toString().trim();
        result.prDate = commitDate.replace(/'/g, '');
      }
      
      // Set PR title and description from latest commit if not already set
      if ((!result.prTitle || result.prTitle.trim() === '') && latestCommit) {
        try {
          const latestCommitMessage = execSync(`git log -1 --pretty=%B ${latestCommit}`).toString().trim();
          const messageLines = latestCommitMessage.trim().split('\n');
          result.prTitle = messageLines[0] || '';
          
          if (messageLines.length > 2) {
            result.prDescription = messageLines.slice(2).join('\n').trim();
          }
        } catch (e) {
          Logger.debug(`Error extracting commit message for PR title: ${e}`);
        }
      }
      
      // Reset directory
      process.chdir(originalDir);
      
      results.push(result);
    } catch (e) {
      Logger.error(`Exception in populating Git metadata for AI selection (folder: ${folder}): ${e}`);
      
      // Reset directory if needed
      try {
        process.chdir(originalDir);
      } catch (dirError) {
        Logger.error(`Error resetting directory: ${dirError}`);
      }
    }
  }
  
  // Filter out results with empty filesChanged
  const filteredResults = results.filter(isValidGitResult);

  // Map to required output format
  const formattedResults = filteredResults.map((result) => ({
    prId: result.prId || '',
    filesChanged: Array.isArray(result.filesChanged) ? result.filesChanged : [],
    authors: Array.isArray(result.authors) ? result.authors : [],
    prDate: result.prDate || '',
    commitMessages: Array.isArray(result.commitMessages)
      ? result.commitMessages.map((cm) => ({
        message: cm.message || '',
        user: cm.user || ''
      }))
      : [],
    prTitle: result.prTitle || '',
    prDescription: result.prDescription || '',
    prRawDiff: result.prRawDiff || ''
  }));
  
  return formattedResults;
};

exports.jsonifyAccessibilityArray = (dataArray, keyName, valueName) => {
  const result = {};
  dataArray.forEach((element) => {
    result[element[keyName]] = element[valueName];
  });
  return result;
};

