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

describe('getUserName', () => {
  let getUserName;
  const settings = {};
  before(() => {
    getUserName = require('../../../src/utils/helper').getUserName;
  });

  it('returns null for empty settings', async () => {
    expect(getUserName(settings)).to.be.oneOf([null, undefined]);
  });

  it('returns null for empty desireCapabilities', async () => {
    settings.desiredCapabilities = {};
    expect(getUserName(settings)).to.be.oneOf([null, undefined]);
  });

  it('returns user for non w3c', async () => {
    settings.desiredCapabilities = {
      'browserstack.user': 'USERNAME'
    };
    expect(getUserName(settings)).to.eq('USERNAME');
  });

  it('returns user for w3c', async () => {
    settings.desiredCapabilities = {
      'bstack:options': {
        'userName': 'USERNAME'
      }
    };
    expect(getUserName(settings)).to.eq('USERNAME');
  });

  it('returns undefined for no user w3c', async () => {
    settings.desiredCapabilities = {
      'bstack:options': {}
    };
    expect(getUserName(settings)).to.be.oneOf([null, undefined]);
  });

  it('returs user from env for no key in settings', async () => {
    process.env.BROWSERSTACK_USERNAME = 'BROWSERSTACK_USERNAME';
    settings.desiredCapabilities = {};

    expect(getUserName(settings)).to.eq('BROWSERSTACK_USERNAME');
  });
});

describe('isAccessibilitySession', () => {
  let isAccessibilitySession;
  before(() => {
    isAccessibilitySession = require('../../../src/utils/helper').isAccessibilitySession;
  });

  it('returns false for undefined', async () => {
    delete process.env.BROWSERSTACK_ACCESSIBILITY;
    expect(isAccessibilitySession()).to.be.false;
  });

  it('returns true if env variable is set to true', async () => {
    process.env.BROWSERSTACK_ACCESSIBILITY = true;
    expect(isAccessibilitySession()).to.be.true;
    delete process.env.BROWSERSTACK_ACCESSIBILITY;
  });

  it('returns false if env variable is set to false', async () => {
    process.env.BROWSERSTACK_ACCESSIBILITY = false;
    expect(isAccessibilitySession()).to.be.false;
    delete process.env.BROWSERSTACK_ACCESSIBILITY;
  });

});

describe('getProjectName', () => {
  let getProjectName;
  let options = {};
  let bstackOptions = {};
  let fromProduct = {};
  before(() => {
    getProjectName = require('../../../src/utils/helper').getProjectName;
  });

  beforeEach(() => {
    options = {};
    bstackOptions = {};
    fromProduct = {};
  });

  it('returns empty for empty options', async () => {
    expect(getProjectName(options, bstackOptions, fromProduct)).to.eq('');
  });

  it('returns projectName from bstackOptions', async () => {
    bstackOptions.projectName = 'bstackOptionsProjectName';
    expect(getProjectName(options, bstackOptions, fromProduct)).to.eq('bstackOptionsProjectName');
  });

  it('returns projectName from bstackOptions if fromProduct is not set', async () => {
    bstackOptions.projectName = 'bstackOptionsProjectName';
    options.test_observability = {projectName: 'obsProjectName'};
    options.accessibility = {projectName: 'accessibilityProjectName'};
    expect(getProjectName(options, bstackOptions, fromProduct)).to.eq('bstackOptionsProjectName');
  });

  it('returns projectName from test_observability if fromProduct is set to test_observability', async () => {
    bstackOptions.projectName = 'bstackOptionsProjectName';
    options.test_observability = {projectName: 'obsProjectName'};
    options.accessibility = {projectName: 'accessibilityProjectName'};
    fromProduct.test_observability = true;
    expect(getProjectName(options, bstackOptions, fromProduct)).to.eq('obsProjectName');
  });

  it('returns projectName from accessibility if fromProduct is set to accessibility', async () => {
    bstackOptions.projectName = 'bstackOptionsProjectName';
    options.test_observability = {projectName: 'obsProjectName'};
    options.accessibility = {projectName: 'accessibilityProjectName'};
    fromProduct.accessibility = true;
    expect(getProjectName(options, bstackOptions, fromProduct)).to.eq('accessibilityProjectName');
  });

  it('returns projectName from bstackOptions if fromProduct is set to test_observability and projectName not overriden in test_observability', async () => {
    bstackOptions.projectName = 'bstackOptionsProjectName';
    options.test_observability = {};
    options.accessibility = {projectName: 'accessibilityProjectName'};
    fromProduct.test_observability = true;
    expect(getProjectName(options, bstackOptions, fromProduct)).to.eq('bstackOptionsProjectName');
  });

  it('returns projectName from bstackOptions if fromProduct is set to accessibility and projectName not overriden in accessibility', async () => {
    bstackOptions.projectName = 'bstackOptionsProjectName';
    options.test_observability = {};
    options.accessibility = {};
    fromProduct.test_observability = true;
    expect(getProjectName(options, bstackOptions, fromProduct)).to.eq('bstackOptionsProjectName');
  });

});

describe('getBuildName', () => {
  let getBuildName;
  let options = {};
  let bstackOptions = {};
  let fromProduct = {};
  before(() => {
    getBuildName = require('../../../src/utils/helper').getBuildName;
  });

  beforeEach(() => {
    options = {};
    bstackOptions = {};
    fromProduct = {};
  });

  it('returns empty for empty options', async () => {
    expect(getBuildName(options, bstackOptions, fromProduct)).to.eq('nightwatch-plugin-browserstack');
  });

  it('returns buildName from bstackOptions', async () => {
    bstackOptions.buildName = 'bstackOptionsBuildName';
    expect(getBuildName(options, bstackOptions, fromProduct)).to.eq('bstackOptionsBuildName');
  });

  it('returns buildName from bstackOptions if fromProduct is not set', async () => {
    bstackOptions.buildName = 'bstackOptionsBuildName';
    options.test_observability = {buildName: 'obsBuildName'};
    options.accessibility = {buildName: 'accessibilityBuildName'};
    expect(getBuildName(options, bstackOptions, fromProduct)).to.eq('bstackOptionsBuildName');
  });

  it('returns buildName from test_observability if fromProduct is set to test_observability', async () => {
    bstackOptions.buildName = 'bstackOptionsBuildName';
    options.test_observability = {buildName: 'obsBuildName'};
    options.accessibility = {buildName: 'accessibilityBuildName'};
    fromProduct.test_observability = true;
    expect(getBuildName(options, bstackOptions, fromProduct)).to.eq('obsBuildName');
  });

  it('returns buildName from accessibility if fromProduct is set to accessibility', async () => {
    bstackOptions.buildName = 'bstackOptionsBuildName';
    options.test_observability = {buildName: 'obsBuildName'};
    options.accessibility = {buildName: 'accessibilityBuildName'};
    fromProduct.accessibility = true;
    expect(getBuildName(options, bstackOptions, fromProduct)).to.eq('accessibilityBuildName');
  });

  it('returns buildName from bstackOptions if fromProduct is set to test_observability and projectName not overriden in test_observability', async () => {
    bstackOptions.buildName = 'bstackOptionsBuildName';
    options.test_observability = {};
    options.accessibility = {};
    fromProduct.test_observability = true;
    expect(getBuildName(options, bstackOptions, fromProduct)).to.eq('bstackOptionsBuildName');
  });

  it('returns buildName from bstackOptions if fromProduct is set to accessibility and projectName not overriden in accessibility', async () => {
    bstackOptions.buildName = 'bstackOptionsBuildName';
    options.test_observability = {};
    options.accessibility = {};
    fromProduct.test_observability = true;
    expect(getBuildName(options, bstackOptions, fromProduct)).to.eq('bstackOptionsBuildName');
  });

});

describe('isBrowserstackInfra', () => {
  let isBrowserstackInfra;
  before(() => {
    isBrowserstackInfra = require('../../../src/utils/helper').isBrowserstackInfra;
  });

  it('returns true for undefined settings', async () => {
    expect(isBrowserstackInfra()).to.be.true;
  });

  it('returns true for empty settings', async () => {
    expect(isBrowserstackInfra({})).to.be.true;
  });

  it('returns true if webdriver.host contains browserstack', async () => {
    const settings = {
      webdriver: {
        host: 'hub-cloud.browserstack.com'
      }
    };
    expect(isBrowserstackInfra(settings)).to.be.true;
  });

  it('returns false if webdriver.host does not contain browserstack', async () => {
    const settings = {
      webdriver: {
        host: 'localhost'
      }
    };
    expect(isBrowserstackInfra(settings)).to.be.false;
  });

});
