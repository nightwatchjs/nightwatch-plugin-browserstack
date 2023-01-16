const {expect} = require('chai');

describe('LocalTunnel', () => {
  let LocalTunnel;
  let localTunnel;
  let settings = {
    '@nightwatch/browserstack': {
      browserstackLocal: true,
      browserstackLocalOptions: {
        localIdentifier: 'hello123',
        forceLocal: true
      }
    },
    desiredCapabilities: {
      'bstack:options': {
        accessKey: 'ACCESS_KEY'
      }
    }
  };
  
  before(() => {
    LocalTunnel = require('../../src/local-tunnel');
  });

  describe('configure', () => {
    
    beforeEach(() => {
      localTunnel = new LocalTunnel();
    });
  
    it('sets plugin options', () => {
      localTunnel.configure({...settings});
      expect(localTunnel._settings).to.deep.eq({...settings['@nightwatch/browserstack']});
    });
  
    it('sets local options', () => {
      localTunnel.configure({...settings});
      expect(localTunnel._localOpts).to.deep.eq({...settings['@nightwatch/browserstack'].browserstackLocalOptions});
  
      const extraSettings = {...settings, ...{
        '@nightwatch/browserstack': {
          localOptions: {
            browserstackLocal: true,
            localIdentifier: '123'
          }
        }
      }};
      localTunnel.configure(extraSettings);
      expect(localTunnel._localOpts).to.deep.eq({...extraSettings['@nightwatch/browserstack'].localOptions});
    });
  
    it('honors browserstackLocal: true', () => {
      localTunnel.configure({...settings});
      expect(localTunnel._localTunnel).to.be.not.undefined;
    });
  
    it('honors browserstackLocal: false', () => {
      const extraSettings = {...settings, ...{
        '@nightwatch/browserstack': {
          browserstackLocal: false
        }
      }};
      localTunnel.configure(extraSettings);
      expect(localTunnel._localTunnel).to.be.undefined;
    });
  
    it('honors browserstackLocal: false', () => {
      const extraSettings = {...settings, ...{
        '@nightwatch/browserstack': {
          browserstackLocal: false
        }
      }};
      localTunnel.configure(extraSettings);
      expect(localTunnel._localTunnel).to.be.undefined;
    });
  
    it('sets key', () => {
      localTunnel.configure({...settings});
      expect(localTunnel._key).to.eq('ACCESS_KEY');
    });
  });

  describe('start', () => {
    it('throws error when key not defined', async () => {
      settings = {
        '@nightwatch/browserstack': {
          browserstackLocal: true
        }
      };
      localTunnel = new LocalTunnel();
      localTunnel.configure(settings);
      
      let err;
      try {
        await localTunnel.start();
      } catch (er) {
        err = er;
      }

      expect(err).to.be.not.undefined;
    });
  });
});
