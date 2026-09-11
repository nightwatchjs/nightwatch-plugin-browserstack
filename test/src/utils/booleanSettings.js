const {expect} = require('chai');

const helper = require('../../../src/utils/helper');

describe('parseBooleanSetting', () => {
  it('returns undefined when the setting is absent', () => {
    expect(helper.parseBooleanSetting(undefined)).to.eq(undefined);
    expect(helper.parseBooleanSetting(null)).to.eq(undefined);
  });

  it('passes booleans through', () => {
    expect(helper.parseBooleanSetting(true)).to.eq(true);
    expect(helper.parseBooleanSetting(false)).to.eq(false);
  });

  it('accepts the string forms a YAML or env-derived config produces', () => {
    ['true', 'True', ' TRUE ', '1', 'yes', 'on'].forEach((value) => {
      expect(helper.parseBooleanSetting(value), value).to.eq(true);
    });
    ['false', 'False', ' FALSE ', '0', 'no', 'off', ''].forEach((value) => {
      expect(helper.parseBooleanSetting(value), value).to.eq(false);
    });
  });

  it('accepts numeric forms', () => {
    expect(helper.parseBooleanSetting(1)).to.eq(true);
    expect(helper.parseBooleanSetting(0)).to.eq(false);
  });
});

describe('isTestHubBuild at build start', () => {
  const envKeys = ['BROWSERSTACK_TEST_OBSERVABILITY', 'BROWSERSTACK_TEST_REPORTING', 'BROWSERSTACK_ACCESSIBILITY'];
  let saved;

  beforeEach(() => {
    saved = {};
    envKeys.forEach((key) => {
      saved[key] = process.env[key];
      delete process.env[key];
    });
  });

  afterEach(() => {
    envKeys.forEach((key) => {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    });
  });

  it('starts a build whenever reporting resolved to enabled', () => {
    process.env.BROWSERSTACK_TEST_OBSERVABILITY = 'true';
    expect(helper.isTestHubBuild({}, true)).to.eq(true);
  });

  it('does not start a build when reporting resolved to disabled', () => {
    process.env.BROWSERSTACK_TEST_OBSERVABILITY = 'false';
    process.env.BROWSERSTACK_TEST_REPORTING = 'false';
    expect(helper.isTestHubBuild({test_observability: {enabled: true}}, true)).to.eq(false);
  });

  it('starts a build for a truthy accessibility setting', () => {
    process.env.BROWSERSTACK_TEST_OBSERVABILITY = 'false';
    process.env.BROWSERSTACK_TEST_REPORTING = 'false';
    expect(helper.isTestHubBuild({accessibility: 'true'}, true)).to.eq(true);
  });
});

describe('TestObservability.configure normalises enabled', () => {
  const envKeys = ['BROWSERSTACK_TEST_OBSERVABILITY', 'BROWSERSTACK_TEST_REPORTING'];
  let saved;
  let TestObservability;

  before(() => {
    TestObservability = require('../../../src/testObservability');
  });

  beforeEach(() => {
    saved = {};
    envKeys.forEach((key) => {
      saved[key] = process.env[key];
      delete process.env[key];
    });
  });

  afterEach(() => {
    envKeys.forEach((key) => {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    });
  });

  // configure() disables reporting outright when credentials are absent, so every
  // case below has to carry them for the `enabled` resolution to be observable.
  const withCredentials = (observability = {}) => Object.assign({user: 'USER', key: 'KEY'}, observability);

  const configure = (pluginSettings) => {
    new TestObservability().configure({'@nightwatch/browserstack': pluginSettings});
  };

  it('writes true for a string enabled', () => {
    configure({test_observability: withCredentials({enabled: 'true'})});
    expect(process.env.BROWSERSTACK_TEST_OBSERVABILITY).to.eq('true');
    expect(process.env.BROWSERSTACK_TEST_REPORTING).to.eq('true');
  });

  it('writes true for a numeric enabled', () => {
    configure({test_observability: withCredentials({enabled: 1})});
    expect(process.env.BROWSERSTACK_TEST_OBSERVABILITY).to.eq('true');
  });

  it('writes false for a string false', () => {
    configure({test_observability: withCredentials({enabled: 'false'})});
    expect(process.env.BROWSERSTACK_TEST_OBSERVABILITY).to.eq('false');
    expect(process.env.BROWSERSTACK_TEST_REPORTING).to.eq('false');
  });

  it('leaves the default on when enabled is absent', () => {
    configure({test_observability: withCredentials()});
    expect(process.env.BROWSERSTACK_TEST_OBSERVABILITY).to.eq('true');
  });

  it('honours a top-level string flag', () => {
    new TestObservability().configure({
      testObservability: 'false',
      '@nightwatch/browserstack': {test_observability: withCredentials()}
    });
    expect(process.env.BROWSERSTACK_TEST_OBSERVABILITY).to.eq('false');
  });
});
