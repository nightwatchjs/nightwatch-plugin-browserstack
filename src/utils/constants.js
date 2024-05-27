exports.BATCH_SIZE = 1000;
exports.BATCH_INTERVAL = 2000;
exports.API_URL = 'https://collector-observability.browserstack.com';
exports.SCREENSHOT_EVENT_URL = 'api/v1/screenshots';
exports.BATCH_EVENT_URL = 'api/v1/batch';
exports.RERUN_FILE = 'rerun.json';
exports.DEFAULT_WAIT_TIMEOUT_FOR_PENDING_UPLOADS = 5000;
exports.DEFAULT_WAIT_INTERVAL_FOR_PENDING_UPLOADS = 100;
exports.CUSTOM_REPORTER_CALLBACK_TIMEOUT = 3600000;
exports.consoleHolder = Object.assign({}, console);

// Regex = TEST-OBSERVABILITY-PID-TESTCASE-MAPPING-ea78bf4a-d02b-40bc-8f52-7b53a4350b2c
exports.PID_MAPPING_REGEX = /^TEST-OBSERVABILITY-PID-TESTCASE-MAPPING-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
exports.IPC_SERVER_NAME = 'browserstackTestObservability';
exports.EVENTS = {
  LOG: 'testObservability:log',
  LOG_INIT: 'testObservability:log:init',
  SCREENSHOT: 'testObservability:screenshot'
};
exports.ACCESSIBILITY_URL= 'https://accessibility.browserstack.com/api';

// Maximum size of VCS info which is allowed
exports.MAX_GIT_META_DATA_SIZE_IN_BYTES = 64 * 1024;

/* The value to be appended at the end if git metadata is larger than
MAX_GIT_META_DATA_SIZE_IN_BYTES
*/
exports.GIT_META_DATA_TRUNCATED = '...[TRUNCATED]';
