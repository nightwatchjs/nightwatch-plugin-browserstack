const path = require('path');
const Module = require('module');
const sinon = require('sinon');
const {expect} = require('chai');

// accessibilityAutomation participates in a circular require
// (accessibilityAutomation -> helper -> logPatcher -> testObservability -> accessibilityAutomation),
// and testObservability instantiates AccessibilityAutomation at load time. Warm up the chain via
// helper first so the class is fully exported before we require it directly.
require('../../src/utils/helper');
const AccessibilityAutomation = require('../../src/accessibilityAutomation');
const AccessibilityScripts = require('../../src/scripts/accessibilityScripts');

describe('AccessibilityAutomation.shouldPatchExecuteScript', () => {
  let instance;

  before(() => {
    instance = new AccessibilityAutomation();
  });

  it('returns true (skip scan) for an empty/undefined script', () => {
    expect(instance.shouldPatchExecuteScript(undefined)).to.eq(true);
    expect(instance.shouldPatchExecuteScript(null)).to.eq(true);
    expect(instance.shouldPatchExecuteScript('')).to.eq(true);
  });

  it('returns true (skip scan) for the plugin\'s internal browserstack scripts', () => {
    expect(instance.shouldPatchExecuteScript('browserstack_executor: {"action":"appAllyScan"}')).to.eq(true);
    expect(instance.shouldPatchExecuteScript('BROWSERSTACK_EXECUTOR: {}')).to.eq(true);
    expect(instance.shouldPatchExecuteScript('browserstack_accessibility_automation_script')).to.eq(true);
  });

  it('returns false (trigger scan) for a normal user string script', () => {
    expect(instance.shouldPatchExecuteScript('mobile:scroll')).to.eq(false);
    expect(instance.shouldPatchExecuteScript('return document.title')).to.eq(false);
  });

  it('returns false (trigger scan) for a function-form user script', () => {
    // Regression: a function script was previously treated as "skip", so
    // browser.execute(function(){...}) never triggered an accessibility scan.
    expect(instance.shouldPatchExecuteScript(function () {})).to.eq(false);
    expect(instance.shouldPatchExecuteScript(() => {})).to.eq(false);
  });
});

describe('AccessibilityAutomation.commandWrapper', () => {
  const fakeMain = path.join('/tmp', 'fake-nightwatch', 'index.js');
  const fakeDir = path.dirname(fakeMain);
  const objPath = path.join(fakeDir, 'api/web-element/commands', 'objCmd.js');
  const classPath = path.join(fakeDir, 'api/client-commands/document', 'executeScript.js');

  let resolveStub; let instance; let perfStub; let objModule; let ClassModule; let origObjCmd; let origClassCmd;

  beforeEach(async () => {
    const origResolve = Module._resolveFilename;
    resolveStub = sinon.stub(Module, '_resolveFilename').callsFake(function (request, ...rest) {
      if (request === 'nightwatch') {
        return fakeMain;
      }
      if (request === objPath || request === classPath) {
        return request;
      }

      return origResolve.call(this, request, ...rest);
    });

    // Object-export command (web-element style): `module.exports.command = fn`.
    origObjCmd = function () { return 'obj-orig' };
    objModule = {command: origObjCmd};

    // Class-export command (executeScript style): `command` lives on the prototype.
    origClassCmd = function () { return 'class-orig' };
    ClassModule = class ExecuteScript {};
    ClassModule.prototype.command = origClassCmd;

    require.cache[objPath] = {id: objPath, filename: objPath, loaded: true, exports: objModule};
    require.cache[classPath] = {id: classPath, filename: classPath, loaded: true, exports: ClassModule};

    AccessibilityScripts.commandsToWrap = [
      {method: 'command', path: 'api/web-element/commands', name: ['objCmd']},
      {method: 'command', path: 'api/client-commands/document', name: ['executeScript']}
    ];

    global.browser = {};
    instance = new AccessibilityAutomation();
    perfStub = sinon.stub(instance, 'performScan').resolves('scanned');

    await instance.commandWrapper();
  });

  afterEach(() => {
    resolveStub.restore();
    delete require.cache[objPath];
    delete require.cache[classPath];
    delete global.browser;
    AccessibilityScripts.commandsToWrap = null;
  });

  it('wraps the own `command` of an object-export (web-element) command', () => {
    expect(objModule.command).to.be.a('function');
    expect(objModule.command).to.not.eq(origObjCmd);
  });

  it('wraps the prototype `command` of a class-export command, not a static', () => {
    expect(ClassModule.prototype.command).to.not.eq(origClassCmd);
    // The original bug patched a non-existent static `command`; ensure we did NOT create one.
    expect(Object.prototype.hasOwnProperty.call(ClassModule, 'command')).to.eq(false);
  });

  it('class-export wrapped command triggers performScan and delegates to the original', async () => {
    const result = await new ClassModule().command('mobile:scroll');

    expect(perfStub.calledOnce).to.eq(true);
    expect(perfStub.firstCall.args[1]).to.eq('executeScript');
    expect(result).to.eq('class-orig');
  });

  it('skips performScan for the plugin\'s internal browserstack_executor script (recursion guard)', async () => {
    await new ClassModule().command('browserstack_executor: {"action":"appAllyScan"}');

    expect(perfStub.called).to.eq(false);
  });

  it('triggers performScan for a function-form user script passed to execute', async () => {
    await new ClassModule().command(function () {});

    expect(perfStub.calledOnce).to.eq(true);
  });

  it('triggers performScan for a non-execute object-export command', async () => {
    await objModule.command();

    expect(perfStub.calledOnce).to.eq(true);
    expect(perfStub.firstCall.args[1]).to.eq('objCmd');
  });
});
