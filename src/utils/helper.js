const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('node:http');
const https = require('node:https');
const request = require('request');
const {promisify} = require('util');
const gitRepoInfo = require('git-repo-info');
const gitconfig = require('gitconfiglocal');
const {API_URL, RERUN_FILE} = require('./constants');
const pGitconfig = promisify(gitconfig);

const httpKeepAliveAgent = new http.Agent({
  keepAlive: true,
  timeout: 60000,
  maxSockets: 2,
  maxTotalSockets: 2
});

const httpsKeepAliveAgent = new https.Agent({
  keepAlive: true,
  timeout: 60000,
  maxSockets: 2,
  maxTotalSockets: 2
});

const httpScreenshotsKeepAliveAgent = new http.Agent({
  keepAlive: true,
  timeout: 60000,
  maxSockets: 2,
  maxTotalSockets: 2
});

const httpsScreenshotsKeepAliveAgent = new https.Agent({
  keepAlive: true,
  timeout: 60000,
  maxSockets: 2,
  maxTotalSockets: 2
});

const RequestQueueHandler = require('./requestQueueHandler');
exports.requestQueueHandler = new RequestQueueHandler();
exports.pending_test_uploads = {
  count: 0
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
  return config.user  || bstackOptions.userName || process.env.BROWSERSTACK_USERNAME;
};

exports.getObservabilityKey = (config, bstackOptions={}) => {
  return config.key || bstackOptions.accessKey || process.env.BROWSERSTACK_ACCESS_KEY;
};

exports.getObservabilityProject = (options, bstackOptions={}) => {
  if (options.testObservabilityOptions && options.testObservabilityOptions.projectName) {
    return options.testObservabilityOptions.projectName;
  } else if (bstackOptions.projectName) {
    return bstackOptions.projectName;
  }

  return '';
  
};

exports.getObservabilityBuild = (options, bstackOptions={}) => {
  if (options.testObservabilityOptions && options.testObservabilityOptions.buildName) {
    return options.testObservabilityOptions.buildName;
  } else if (bstackOptions.buildName) {
    return bstackOptions.buildName;
  }

  return path.basename(path.resolve(process.cwd()));
};

exports.getObservabilityBuildTags = (options, bstackOptions={}) => {
  if (options.testObservabilityOptions && options.testObservabilityOptions.buildTag) {
    return options.testObservabilityOptions.buildTag;
  } else if (bstackOptions.buildTag) {
    return bstackOptions.buildTag;
  }

  return [];
};

exports.getCiInfo = () => {
  var env = process.env;
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
  if (env.CI === 'true' && env.CIRCLECI === 'true') {
    return {
      name: 'CircleCI',
      build_url: env.CIRCLE_BUILD_URL,
      job_name: env.CIRCLE_JOB,
      build_number: env.CIRCLE_BUILD_NUM
    };
  }
  // Travis CI
  if (env.CI === 'true' && env.TRAVIS === 'true') {
    return {
      name: 'Travis CI',
      build_url: env.TRAVIS_BUILD_WEB_URL,
      job_name: env.TRAVIS_JOB_NAME,
      build_number: env.TRAVIS_BUILD_NUMBER
    };
  }
  // Codeship
  if (env.CI === 'true' && env.CI_NAME === 'codeship') {
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
  if (env.CI === 'true' && env.DRONE === 'true') {
    return {
      name: 'Drone',
      build_url: env.DRONE_BUILD_LINK,
      job_name: null,
      build_number: env.DRONE_BUILD_NUMBER
    };
  }
  // Semaphore
  if (env.CI === 'true' && env.SEMAPHORE === 'true') {
    return {
      name: 'Semaphore',
      build_url: env.SEMAPHORE_ORGANIZATION_URL,
      job_name: env.SEMAPHORE_JOB_NAME,
      build_number: env.SEMAPHORE_JOB_ID
    };
  }
  // GitLab
  if (env.CI === 'true' && env.GITLAB_CI === 'true') {
    return {
      name: 'GitLab',
      build_url: env.CI_JOB_URL,
      job_name: env.CI_JOB_NAME,
      build_number: env.CI_JOB_ID
    };
  }
  // Buildkite
  if (env.CI === 'true' && env.BUILDKITE === 'true') {
    return {
      name: 'Buildkite',
      build_url: env.BUILDKITE_BUILD_URL,
      job_name: env.BUILDKITE_LABEL || env.BUILDKITE_PIPELINE_NAME,
      build_number: env.BUILDKITE_BUILD_NUMBER
    };
  }
  // Visual Studio Team Services
  if (env.TF_BUILD === 'True') {
    return {
      name: 'Visual Studio Team Services',
      build_url: `${env.SYSTEM_TEAMFOUNDATIONSERVERURI}${env.SYSTEM_TEAMPROJECTID}`,
      job_name: env.SYSTEM_DEFINITIONID,
      build_number: env.BUILD_BUILDID
    };
  }

  // if no matches, return null
  return null;
};

const findGitConfig = (filePath) => {
  if (filePath == null || filePath === '' || filePath === '/') {
    return null;
  }
  try {
    fs.statSync(filePath + '/.git/config');

    return filePath;
  } catch (e) {
    const parentFilePath = filePath.split('/');
    parentFilePath.pop();

    return findGitConfig(parentFilePath.join('/'));
  }
};

exports.getGitMetaData = async () => {
  const info = gitRepoInfo();
  if (!info.commonGitDir) {
    console.log('nightwatch-browserstack-plugin: Unable to find a Git directory');

    return;
  }
  const {remote} = await pGitconfig(info.commonGitDir);
  const remotes = Object.keys(remote).map(remoteName =>  ({name: remoteName, url: remote[remoteName].url}));

  return {
    name: 'git',
    sha: info.sha,
    short_sha: info.abbreviatedSha,
    branch: info.branch,
    tag: info.tag,
    committer: info.committer,
    committer_date: info.committerDate,
    author: info.author,
    author_date: info.authorDate,
    commit_message: info.commitMessage,
    root: info.root,
    common_git_dir: info.commonGitDir,
    worktree_git_dir: info.worktreeGitDir,
    last_tag: info.lastTag,
    commits_since_last_tag: info.commitsSinceLastTag,
    remotes: remotes
  };
};

exports.requireModule = (module) => {
  console.log(`nightwatch-browserstack-plugin: Getting ${module} from ${process.cwd()}`);
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

exports.makeRequest = (type, url, data, config) => {
  return new Promise((resolve, reject) => {
    const options = {...config, ...{
      method: type,
      url: `${API_URL}/${url}`,
      body: data,
      json: config.headers['Content-Type'] === 'application/json',
      agent: API_URL.includes('https') ? httpsKeepAliveAgent : httpKeepAliveAgent
    }};

    if (url === exports.requestQueueHandler.screenshotEventUrl) {
      options.agent = API_URL.includes('https') ? httpsScreenshotsKeepAliveAgent : httpScreenshotsKeepAliveAgent;
    }

    request(options, function callback(error, response, body) {
      if (error) {
        reject(error);
      } else if (response.statusCode !== 200) {
        if (response.statusCode === 401) {
          reject(response && response.body ? response.body : `Received response from BrowserStack Server with status : ${response.statusCode}`);
        } else {
          reject(`Received response from BrowserStack Server with status : ${response.statusCode}`);
        }
      } else {
        try {
          if (typeof(body) !== 'object') {body = JSON.parse(body)}
        } catch (e) {
          reject('Not a JSON response from BrowserStack Server');
        }
        resolve({
          data: body
        });
      }
    });
  });
};

exports.pending_test_uploads = {
  count: 0
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

  if (process.env.BS_TESTOPS_JWT !== 'null') {
    exports.pending_test_uploads.count += 1;
  }
  
  if (process.env.BS_TESTOPS_BUILD_COMPLETED === 'true') {
    if (process.env.BS_TESTOPS_JWT === 'null') {
      console.log(`nightwatch-browserstack-plugin: EXCEPTION IN ${log_tag} REQUEST TO TEST OBSERVABILITY : missing authentication token`);
      exports.pending_test_uploads.count = Math.max(0, exports.pending_test_uploads.count-1);

      return {
        status: 'error',
        message: 'Token/buildID is undefined, build creation might have failed'
      };
    } 
    let data = eventData; 
    let event_api_url = 'api/v1/event';
      
    exports.requestQueueHandler.start();
    const {
      shouldProceed,
      proceedWithData,
      proceedWithUrl
    } = exports.requestQueueHandler.add(eventData);
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
      const response = await this.makeRequest('POST', event_api_url, data, config);
      if (response.data.error) {
        throw ({message: response.data.error});
      } else {
        exports.pending_test_uploads.count = Math.max(0, exports.pending_test_uploads.count - (event_api_url === 'api/v1/event' ? 1 : data.length));

        return {
          status: 'success',
          message: ''
        };
      }
    } catch (error) {
      if (error.response) {
        console.log(`nightwatch-browserstack-plugin: EXCEPTION IN ${event_api_url !== exports.requestQueueHandler.eventUrl ? log_tag : 'Batch_Queue'} REQUEST TO TEST OBSERVABILITY : ${error.response.status} ${error.response.statusText} ${JSON.stringify(error.response.data)}`);
      } else {
        console.log(`nightwatch-browserstack-plugin: EXCEPTION IN ${event_api_url !== exports.requestQueueHandler.eventUrl ? log_tag : 'Batch_Queue'} REQUEST TO TEST OBSERVABILITY : ${error.message || error}`);
      }
      exports.pending_test_uploads.count = Math.max(0, exports.pending_test_uploads.count - (event_api_url === 'api/v1/event' ? 1 : data.length));

      return {
        status: 'error',
        message: error.message || (error.response ? `${error.response.status}:${error.response.statusText}` : error)
      };
    }
  }
};

exports.batchAndPostEvents = async (eventUrl, kind, data) => {
  const config = {
    headers: {
      'Authorization': `Bearer ${process.env.BS_TESTOPS_JWT}`,
      'Content-Type': 'application/json',
      'X-BSTACK-TESTOPS': 'true'
    }
  };

  try {
    const response = await this.makeRequest('POST', eventUrl, data, config);
    if (response.data.error) {
      throw ({message: response.data.error});
    } else {
      exports.pending_test_uploads.count = Math.max(0, exports.pending_test_uploads.count - data.length);
    }
  } catch (error) {
    if (error.response) {
      console.log(`nightwatch-browserstack-plugin: EXCEPTION IN ${kind} REQUEST TO TEST OBSERVABILITY : ${error.response.status} ${error.response.statusText} ${JSON.stringify(error.response.data)}`);
    } else {
      console.log(`nightwatch-browserstack-plugin: EXCEPTION IN ${kind} REQUEST TO TEST OBSERVABILITY : ${error.message || error}`);
    }
    exports.pending_test_uploads.count = Math.max(0, exports.pending_test_uploads.count - data.length);
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

exports.getCloudProvider = (hostname) => {
  if (hostname.includes('browserstack')) {
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

exports.handleNightwatchRerun = (specs) => {
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

  fs.writeFileSync(RERUN_FILE, JSON.stringify(data), (error) => {
    if (error) {
      console.error(error);
      throw error;
    }
  });
  process.env.NIGHTWATCH_RERUN_FAILED = true;
  process.env.NIGHTWATCH_RERUN_FAILED_FILE = path.resolve(RERUN_FILE);
};

exports.deleteRerunFile = () => {
  try {
    fs.unlinkSync(path.resolve(RERUN_FILE));
  } catch (err) {
    console.error(err);
  }
};

