const helper = require('../../../src/utils/helper');
const TestObservability = require('../../../src/testObservability');
const sinon = require('sinon');
const fs = require('fs');

describe('TestObservability - processTestRunData', function () {
  beforeEach(() => {
    this.sandbox = sinon.createSandbox();
    this.testObservability = new TestObservability();

    this.eventData = {commands: []};
    this.sectionName = 'testSection';
    this.testFileReport = {};
    this.hookIds = [];
    this.sendTestRunEventStub = this.sandbox.stub(this.testObservability, 'sendTestRunEvent').resolves();
  });

  afterEach(() => {
    this.sandbox.restore();
  });

  it('should send test run events', async () => {
    await this.testObservability.processTestRunData(this.eventData, this.sectionName, this.testFileReport, this.hookIds);
    sinon.assert.calledTwice(this.sendTestRunEventStub);
    sinon.assert.calledWith(this.sendTestRunEventStub.firstCall, this.eventData, this.testFileReport, 'TestRunStarted', sinon.match.string, null, this.sectionName, this.hookIds);
    sinon.assert.calledWith(this.sendTestRunEventStub.secondCall, this.eventData, this.testFileReport, 'TestRunFinished', sinon.match.string, null, this.sectionName, this.hookIds);
  });

  it('should create screenshot log events', async () => {
    this.eventData = {
      commands: [
        {name: 'saveScreenshot', args: ['path/to/screenshot.png'], startTime: 'start_time'}
      ]
    };
    this.sandbox.stub(fs, 'existsSync').callsFake(() => true);
    this.sandbox.stub(fs, 'readFileSync').callsFake(() => 'screenshot-base-64');
    const createScreenshotLogEventStub = this.sandbox.stub(this.testObservability, 'createScreenshotLogEvent');

    process.env.BS_TESTOPS_ALLOW_SCREENSHOTS = 'true';
    await this.testObservability.processTestRunData(this.eventData, this.sectionName, this.testFileReport, this.hookIds);
    process.env.BS_TESTOPS_ALLOW_SCREENSHOTS = 'false';
    sinon.assert.calledOnceWithExactly(createScreenshotLogEventStub, sinon.match.string, 'screenshot-base-64', 'start_time');
  });
});
