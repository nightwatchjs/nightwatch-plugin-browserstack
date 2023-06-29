const TestObservability = require('../../../src/testObservability');
const sinon = require('sinon');

describe('TestObservability - processTestRunData', function () {
  let testObservability; let sandbox; let eventData; let sectionName; let testFileReport; let hookIds; let sendTestRunEventStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    testObservability = new TestObservability();

    eventData = {commands: []};
    sectionName = 'testSection';
    testFileReport = {};
    hookIds = [];
    sendTestRunEventStub = sandbox.stub(testObservability, 'sendTestRunEvent').resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should send test run events', async function () {
    await testObservability.processTestRunData(eventData, sectionName, testFileReport, hookIds);
    sinon.assert.calledTwice(sendTestRunEventStub);
    sinon.assert.calledWith(sendTestRunEventStub.firstCall, eventData, testFileReport, 'TestRunStarted', sinon.match.string, null, sectionName, hookIds);
    sinon.assert.calledWith(sendTestRunEventStub.secondCall, eventData, testFileReport, 'TestRunFinished', sinon.match.string, null, sectionName, hookIds);
  });

  it('should create screenshot log events', async () => {
    eventData = {
      commands: [
        {name: 'saveScreenshot', args: ['path/to/screenshot.png'], startTime: 'start_time'}
      ]
    };
    const createScreenshotLogEventStub = sandbox.stub(testObservability, 'createScreenshotLogEvent');
    process.env.BS_TESTOPS_ALLOW_SCREENSHOTS = 'true';
    await testObservability.processTestRunData(eventData, sectionName, testFileReport, hookIds);
    process.env.BS_TESTOPS_ALLOW_SCREENSHOTS = 'false';
    sinon.assert.calledOnceWithExactly(createScreenshotLogEventStub, sinon.match.string, 'path/to/screenshot.png', 'start_time');
  });
});
