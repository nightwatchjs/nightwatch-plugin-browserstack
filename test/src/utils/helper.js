const {expect} = require('chai');
const mockery = require('mockery');


describe('generateLocalIdentifier', () => {
  let generateLocalIdentifier;
  before(() => {
    mockery.enable();

    var os = {
      hostname: function() {
        return 'HOSTNAME';
      }
    };

    mockery.registerMock('os', os);
    delete require.cache[require.resolve('../../../src/utils/helper')];
    generateLocalIdentifier = require('../../../src/utils/helper').generateLocalIdentifier;
  });

  it('returns identifier with correct format', async () => {
    const identifierComponents = generateLocalIdentifier().split('_');
    expect(identifierComponents.length).to.eq(5);
    expect(identifierComponents[0]).to.eq(new Date().getDate().toString());
    expect(identifierComponents[1]).to.eq(new Date().toLocaleString('en-GB', {month: 'short'}));
    expect(identifierComponents[3]).to.eq('HOSTNAME');
    expect(identifierComponents[4].length).to.eq(4);
  });

  after(() => {
    mockery.disable();
  });
});

describe('isUndefined', () => {
  let isUndefined;
  before(() => {
    isUndefined = require('../../../src/utils/helper').isUndefined;
  });

  it('returns true for undefined', async () => {
    expect(isUndefined(undefined)).to.be.true;
  });

  it('returns true for null', async () => {
    expect(isUndefined(null)).to.be.true;
  });

  it('returns false for other values', async () => {
    expect(isUndefined('null')).to.be.false;
    expect(isUndefined('')).to.be.false;
    expect(isUndefined(0)).to.be.false;
  });
});

describe('isObject', () => {
  let isObject;
  before(() => {
    isObject = require('../../../src/utils/helper').isObject;
  });

  it('returns false for undefined and null', async () => {
    expect(isObject(undefined)).to.be.false;
    expect(isObject(null)).to.be.false;
  });

  it('returns true for objects', async () => {
    expect(isObject({})).to.be.true;
    expect(isObject({'h': 1})).to.be.true;
    expect(isObject(new Object())).to.be.true;
  });
});

describe('getAccessKey', () => {
  let getAccessKey;
  const settings = {};
  before(() => {
    getAccessKey = require('../../../src/utils/helper').getAccessKey;
  });

  it('returns null for empty settings', async () => {
    expect(getAccessKey(settings)).to.be.oneOf([null, undefined]);
  });

  it('returns null for empty desireCapabilities', async () => {
    settings.desiredCapabilities = {};
    expect(getAccessKey(settings)).to.be.oneOf([null, undefined]);
  });

  it('returns key for non w3c', async () => {
    settings.desiredCapabilities = {
      'browserstack.key': 'ACCESS_KEY'
    };
    expect(getAccessKey(settings)).to.eq('ACCESS_KEY');
  });

  it('returns key for w3c', async () => {
    settings.desiredCapabilities = {
      'bstack:options': {
        'accessKey': 'ACCESS_KEY'
      }
    };
    expect(getAccessKey(settings)).to.eq('ACCESS_KEY');
  });

  it('returns undefined for no key w3c', async () => {
    settings.desiredCapabilities = {
      'bstack:options': {}
    };
    expect(getAccessKey(settings)).to.be.oneOf([null, undefined]);
  });

  it('returs key from env for no key in settings', async () => {
    process.env.BROWSERSTACK_ACCESS_KEY = 'ACCESS_KEY';
    settings.desiredCapabilities = {};

    expect(getAccessKey(settings)).to.eq('ACCESS_KEY');
  });
});
