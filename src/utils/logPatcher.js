const Transport = require('winston-transport');
const {consoleHolder, PID_MAPPING_REGEX, EVENTS} = require('./constants');
const CrashReporter = require('./crashReporter');
const TestObservability = require('../testObservability');
const testObservability = new TestObservability();
const helper = require('./helper');
// const eventHelper = require('./eventHelper');

let testLogs = [];
let _uuid = '';

const LOG_LEVELS = {
  INFO: 'INFO',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG',
  TRACE: 'TRACE',
  WARN: 'WARN'
};

class LogPatcher extends Transport {
  constructor(opts) {
    super(opts);
  }

  logToTestOps = async (level = LOG_LEVELS.INFO, message = ['']) => {
    try {
      const start = Date.now();
      let eventType = EVENTS.LOG;
      if (!message[0].match(PID_MAPPING_REGEX)) {
        consoleHolder[level.toLowerCase()](...message);
      } else {
        eventType = EVENTS.LOG_INIT;
      }
      const pid = process.pid;
      const loggingData = {
        timestamp: new Date().toISOString(),
        level: level.toUpperCase(),
        message: `"${message.join(', ')}"`,
        kind: 'TEST_LOG',
        http_response: {}
      };
  
      const end = Date.now();
      const diff = end - start;
      consoleHolder.log(loggingData?.message, '-- printing console log', 'TIME DIFF-', diff);
    } catch (error) {
      consoleHolder.log('ERROR FOUND IN LOG PATCHER', error);
    }
  };

  /* Patching this would show user an extended trace on their cli */
  trace = (...message) => {
    this.logToTestOps(LOG_LEVELS.TRACE, message);
  };

  debug = (...message) => {
    this.logToTestOps(LOG_LEVELS.DEBUG, message);
  };

  info = (...message) => {
    this.logToTestOps(LOG_LEVELS.INFO, message);
  };

  warn = (...message) => {
    this.logToTestOps(LOG_LEVELS.WARN, message);
  };

  error = (...message) => {
    this.logToTestOps(LOG_LEVELS.ERROR, message);
  };

  log = (...message) => {
    this.logToTestOps(LOG_LEVELS.INFO, message);
  };
};

module.exports = LogPatcher;
