const Transport = require('winston-transport');
const {consoleHolder, PID_MAPPING_REGEX, IPC_SERVER_NAME, EVENTS} = require('./constants');
const CrashReporter = require('./crashReporter');
const TestObservability = require('../testObservability');
const helper = require('./helper');
const eventHelper = require('./eventHelper');
const testObservability = new TestObservability();

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

  flushAllLogs = () => {
    if (testLogs.length === 0) {return}
    testLogs.forEach((logObj) => {
      if (logObj.eventType === EVENTS.LOG) {testObservability.appendTestItemLog(logObj.loggingData, _uuid)}
    });
    testLogs = [];
  };

  logToTestOps = (level = LOG_LEVELS.INFO, message = ['']) => {
    try {
      let eventType = EVENTS.LOG;
      if (typeof message[0] === 'string' && message[0].match(PID_MAPPING_REGEX)) {
        eventType = EVENTS.LOG_INIT;
      } else {
        consoleHolder[level.toLowerCase()](...message);
      }

      if (!helper.shouldSendLogs()) {return}

      const pid = process.pid;
      const loggingData = {
        timestamp: new Date().toISOString(),
        level: level.toUpperCase(),
        message: `"${message.join(', ')}"`,
        kind: 'TEST_LOG',
        http_response: {}
      };

      if (_uuid !== '') {
        testObservability.appendTestItemLog(loggingData, _uuid);
        this.flushAllLogs();
      } else {
        testLogs.push({eventType, loggingData});
      }

      // for non parallel execution
      eventHelper.emitLogEvent(eventType, loggingData);

      // for parallel execution
      if (process.send && eventType === EVENTS.LOG_INIT){
        process.send({eventType: eventType, loggingData: loggingData, pid: pid});
      }

      process.on('message', (data) => {
        if (data.uuid !== undefined){
          _uuid = data.uuid;
          process.env.TEST_RUN_UUID = _uuid;
        }
      });
      process.on('disconnect', async () => {
        this.flushAllLogs();
        await helper.uploadPending();
        await helper.shutDownRequestHandler();
      });
    } catch (error) {
      consoleHolder.log('Error in patching logs', error);
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
