const Transport = require('winston-transport');
const {consoleHolder, PID_MAPPING_REGEX, IPC_SERVER_NAME, IPC_EVENTS} = require('./constants');
const ipc = require('node-ipc');
const CrashReporter = require('./crashReporter');

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

    try {
      ipc.config.id = IPC_SERVER_NAME;
      ipc.config.retry = 1500;
      ipc.config.silent = true;
    
      ipc.connectTo(IPC_SERVER_NAME, () => {
        ipc.of.browserstackTestObservability.on('connect', async() => {
          this.started = true;
        });      
      });
    } catch (error) {
      CrashReporter.uploadCrashReport(error.message, error.stack);
    }
  }

  localLogProcessListener = async (eventType, data) => {
    try {
      if (this.started) {
        await ipc.of.browserstackTestObservability.emit(eventType, data);
      }
    } catch (error) {
      CrashReporter.uploadCrashReport(error.message, error.stack);
    }
  };
  
  logToTestOps = (level = LOG_LEVELS.INFO, message = ['']) => {
    let eventType = IPC_EVENTS.LOG;
    if (!message[0].match(PID_MAPPING_REGEX)) {
      consoleHolder[level.toLowerCase()](...message);
    } else {
      eventType = IPC_EVENTS.LOG_INIT;
    }
    const pid = process.pid;
    const loggingData = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message: `"${message.join(', ')}"`,
      kind: 'TEST_LOG',
      http_response: {}
    };
    this.localLogProcessListener(eventType, {loggingData: loggingData, pid: pid});
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
