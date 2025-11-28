const helper = require('../../../src/utils/helper');
const TestObservability = require('../../../src/testObservability');
const sinon = require('sinon');
const fs = require('fs');

describe('TestObservability - processTestRunData', function () {
  beforeEach(() => {
    this.sandbox = sinon.createSandbox();
    this.testObservability = new TestObservability();

    this.eventData = {commands: [], httpOutput: []};
    this.uuid = 'test-uuid-123';
  });

  afterEach(() => {
    this.sandbox.restore();
  });

  it('should create screenshot log events', async () => {
    this.eventData = {
      commands: [
        {name: 'saveScreenshot', args: ['path/to/screenshot.png'], startTime: 'start_time'}
      ],
      httpOutput: []
    };
    this.sandbox.stub(fs, 'existsSync').callsFake(() => true);
    this.sandbox.stub(fs, 'readFileSync').callsFake(() => 'screenshot-base-64');
    const createScreenshotLogEventStub = this.sandbox.stub(this.testObservability, 'createScreenshotLogEvent');

    process.env.BS_TESTOPS_ALLOW_SCREENSHOTS = 'true';
    await this.testObservability.processTestRunData(this.eventData, this.uuid);
    process.env.BS_TESTOPS_ALLOW_SCREENSHOTS = 'false';
    sinon.assert.calledOnceWithExactly(createScreenshotLogEventStub, this.uuid, 'screenshot-base-64', 'start_time');
  });
});
