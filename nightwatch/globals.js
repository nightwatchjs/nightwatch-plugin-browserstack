const LocalTunnel = require('../src/local-tunnel');

const localTunnel = new LocalTunnel();

module.exports = {
  beforeEach(settings) {
    console.log(settings.hello, 'hello')
  },
  async before(settings) {
    localTunnel.configure(settings);
    await localTunnel.start();
    if (localTunnel._localStarted) {
      settings.desiredCapabilities['bstack:options'].local = true;
      // Adding envs to be updated during selenium start.
      process.env.BROWSERSTACK_LOCAL_ENABLED = true;
      if (localTunnel._localOpts.localIdentifier) {
        process.env.BROWSERSTACK_LOCAL_IDENTIFIER = localTunnel._localOpts.localIdentifier;
        settings.desiredCapabilities['bstack:options'].localIdentifier = localTunnel._localOpts.localIdentifier;
      }
    }
  },

  async after() {
    console.log('Stopping local');
    localTunnel.stop();
  },

  beforeChildProcess(settings) {
    process.env.BROWSERSTACK_LOCAL_ENABLED == "true" && 
    (settings.desiredCapabilities['bstack:options'].local = process.env.BROWSERSTACK_LOCAL_ENABLED);
    process.env.BROWSERSTACK_LOCAL_IDENTIFIER &&
    (settings.desiredCapabilities['bstack:options'].localIdentifier = process.env.BROWSERSTACK_LOCAL_IDENTIFIER);
  },
};
