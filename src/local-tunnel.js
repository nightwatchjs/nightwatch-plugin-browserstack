const util = require('util');
const BStackLocal = require('browserstack-local').Local;

const helper = require('../src/utils/helper');

class LocalTunnel {

  configure(settings = {}) {
    this._settings = settings.browserstackPluginOptions || {};
    this._localOpts = this._settings.localOptions ? this._settings.localOptions : {};
    if (helper.isUndefined(this._localOpts.localIdentifier)) {
      this._localOpts.localIdentifier = helper.generateLocalIdentifier();
    }
    this._key = helper.getAccessKey(settings);
    if(this._settings.local)
      this._localTunnel = new BStackLocal();
  }

  async start() {
    if (this._localTunnel) {
      if (helper.isUndefined(this._key)) {
        console.log('key not defined, skipping local initialisation');
        return;
      }
      try {
        await util.promisify(this._localTunnel.start.bind(this._localTunnel))({ key: this._key, ...this._localOpts });
        this._localStarted = true;
        console.log('Local started successfully');
      } catch (err) {
        console.log('Local failed with error: ', err);
      }
    }
  }

  async stop() {
    try {
      this._localStarted && await util.promisify(this._localTunnel.stop.bind(this._localTunnel))();
    } catch (err) {
    }
  }
};

module.exports = LocalTunnel;
