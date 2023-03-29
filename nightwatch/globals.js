const LocalTunnel = require('../src/local-tunnel');
const TestObservability = require('../src/testObservability');
const helper = require('../src/utils/helper');

const localTunnel = new LocalTunnel();
const testObservability = new TestObservability();

module.exports = {

  reporter: function(results, done) {
    done(results);
  },

  async before(settings) {
    localTunnel.configure(settings);
    await localTunnel.start();

    // default config for plugin- local: false
    if (localTunnel._localTunnel && localTunnel._localTunnel.isRunning()) {
      if (!settings.desiredCapabilities['bstack:options']) {
        settings.desiredCapabilities['bstack:options'] = {};
      }

      settings.desiredCapabilities['bstack:options'].local = true;
      // Adding envs to be updated at beforeChildProcess.
      process.env.BROWSERSTACK_LOCAL_ENABLED = true;
      if (localTunnel._localOpts.localIdentifier) {
        process.env.BROWSERSTACK_LOCAL_IDENTIFIER = localTunnel._localOpts.localIdentifier;
        settings.desiredCapabilities['bstack:options'].localIdentifier = localTunnel._localOpts.localIdentifier;
      }
    }

    testObservability.configure(settings);
    if (testObservability._user && testObservability._key) {
      await testObservability.launchTestSession(settings);
    }

  },

  async after() {
    // this.reporter();
    localTunnel.stop();
  },

  beforeChildProcess(settings) {

    if (!settings.desiredCapabilities['bstack:options']) {
      settings.desiredCapabilities['bstack:options'] = {};
    }

    if (!helper.isUndefined(process.env.BROWSERSTACK_LOCAL_ENABLED) && process.env.BROWSERSTACK_LOCAL_ENABLED.toString() === 'true') {
      settings.desiredCapabilities['bstack:options'].local = process.env.BROWSERSTACK_LOCAL_ENABLED;
    }

    if (process.env.BROWSERSTACK_LOCAL_IDENTIFIER) {
      settings.desiredCapabilities['bstack:options'].localIdentifier = process.env.BROWSERSTACK_LOCAL_IDENTIFIER;
    }
  }
};
