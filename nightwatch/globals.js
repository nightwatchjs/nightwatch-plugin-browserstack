const LocalTunnel = require('../src/local-tunnel');

const localTunnel = new LocalTunnel();

module.exports = {
  async before(settings) {
    process.env.BROWSERSTACK_LOCAL_TOGGLE = "false";
    process.env.BROWSERSTACK_LOCAL_IDENTIFIER = "";
    localTunnel.configure(settings);
    await localTunnel.start();
    if (localTunnel._localStarted) {
      // Adding envs to be updated during selenium start.
      process.env.BROWSERSTACK_LOCAL_TOGGLE = true;
      if (localTunnel._localOpts.localIdentifier) {
        process.env.BROWSERSTACK_LOCAL_IDENTIFIER = localTunnel._localOpts.localIdentifier;
      }
    }
  },

  async after() {
    console.log('Stopping local');
    localTunnel.stop();
  }
};
