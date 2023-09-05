class Logger {
  static info(msg) {
    console.log(`nightwatch-browserstack-plugin: ${msg}`);
  }

  static error(msg) {
    console.error(`nightwatch-browserstack-plugin: ${msg}`);
  }

  static warn(msg) {
    console.warn(`nightwatch-browserstack-plugin: ${msg}`);
  }
};

module.exports = Logger;
