const util = require('util');
const BStackLocal = require('browserstack-local').Local;

const helper = require('../src/utils/helper');

class LocalTunnel {

  configure(settings = {}) {
    this._settings = settings.browserstackPluginOptions || {};
    this._localOpts = this._settings.localOptions || this._settings.browserstackLocalOptions;
    if (helper.isUndefined(this._localOpts)) {
      this._localOpts = {};
    }

    if (helper.isUndefined(this._localOpts.localIdentifier)) {
      this._localOpts.localIdentifier = helper.generateLocalIdentifier();
    }
    this._key = helper.getAccessKey(settings);
    if(this._settings.local || this._settings.browserstackLocal)
      this._localTunnel = new BStackLocal();
  }

  async start() {
    if (this._localTunnel) {
      if (helper.isUndefined(this._key)) {
        console.log('Unable to detect accessKey, skipping BrowserStack Local.');
        return;
      }
      try {
        console.log('Starting BrowserStack Local');
        await util.promisify(this._localTunnel.start.bind(this._localTunnel))({ key: this._key, ...this._localOpts });
        this._localStarted = true;
 
        // handlers for abrup close
        const handler = async () => {
          await this.stop();
          process.exit();
        }
        process.on('SIGINT', handler);
        process.on('SIGTERM', handler);
        console.log('BrowserStack Local started successfully');
      } catch (err) {
        console.log('BrowserStack Local start failed with error: ', err);
      }
    }
  }

  async stop() {
    try {
      if (this._localStarted) {
        await util.promisify(this._localTunnel.stop.bind(this._localTunnel))();
        console.log('BrowserStack Local stopped successfully');
      }
    } catch (err) {
      console.log('BrowserStack Local stop failed with error: ', err);
    }
  }
};

module.exports = LocalTunnel;
