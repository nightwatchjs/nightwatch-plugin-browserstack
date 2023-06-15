const Transport = require('winston-transport');
const {consoleHolder} = require('./constants');

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

  logToTestOps = (level = LOG_LEVELS.INFO, message = ['']) => {
    consoleHolder[level.toLowerCase()](...message);
    process.emit(`bs:addLog:${process.pid}`, {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message: `"${message.join(', ')}"`,
      kind: 'TEST_LOG',
      http_response: {}
    });
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
