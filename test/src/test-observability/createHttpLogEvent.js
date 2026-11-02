const assert = require('assert');
const sinon = require('sinon');

const helper = require('../../../src/utils/helper');
const TestObservability = require('../../../src/testObservability');

// Regression coverage for SDK-6164 / HTTP log ordering.
//
// createHttpLogEvent stamped the event with httpResponse[0] — the instant the
// response landed. Nightwatch builds each httpOutput entry as
// [isoTimestamp, message, params] at the moment the line is logged, so
// httpResponse[0] is request-issue time plus the full round trip. A slow
// request therefore carried a later timestamp than logs emitted while it was
// still in flight, and rendered after them in the Logs tab.
describe('TestObservability - createHttpLogEvent (SDK-6164)', function () {
  const request = (ts, target = 'POST /session/1/url') => [ts, `  Request ${target} `, '{}'];
  const response = (ts, status = 'Response 200 OK') => [ts, `  ${status}`, '{}'];

  beforeEach(() => {
    this.sandbox = sinon.createSandbox();
    this.testObservability = new TestObservability();
    this.captured = [];
    this.sandbox.stub(helper, 'uploadEventData').callsFake(async (eventData) => {
      this.captured.push(eventData.logs[0]);
    });
  });

  afterEach(() => {
    this.sandbox.restore();
  });

  it('stamps the log with the request-issued time, not the response time', async () => {
    await this.testObservability.createHttpLogEvent(
      request('2026-06-01T09:00:00.000Z'),
      response('2026-06-01T09:00:05.000Z'),
      'test-run-uuid'
    );

    assert.strictEqual(this.captured.length, 1);
    assert.strictEqual(this.captured[0].timestamp, '2026-06-01T09:00:00.000Z');
    assert.strictEqual(this.captured[0].kind, 'HTTP');
  });

  it('still measures duration_ms across the full request -> response span', async () => {
    await this.testObservability.createHttpLogEvent(
      request('2026-06-01T09:00:00.000Z'),
      response('2026-06-01T09:00:05.000Z'),
      'test-run-uuid'
    );

    assert.strictEqual(this.captured[0].http_response.duration_ms, 5000);
    assert.strictEqual(this.captured[0].http_response.status_code, '200');
  });

  // The reported symptom: a slow request issued BEFORE a fast one must not
  // render after it once the logs are ordered by timestamp.
  it('keeps issue order for a slow request followed by a fast one', async () => {
    await this.testObservability.createHttpLogEvent(
      request('2026-06-01T09:00:00.000Z', 'POST /session/1/url'),
      response('2026-06-01T09:00:05.000Z'),
      'test-run-uuid'
    );
    await this.testObservability.createHttpLogEvent(
      request('2026-06-01T09:00:01.000Z', 'POST /session/1/element'),
      response('2026-06-01T09:00:01.100Z'),
      'test-run-uuid'
    );

    const byTimestamp = [...this.captured].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
    assert.deepStrictEqual(
      byTimestamp.map((log) => log.http_response.path),
      ['/session/1/url', '/session/1/element']
    );
  });

  it('ignores output pairs that are not a Request/Response pair', async () => {
    await this.testObservability.createHttpLogEvent(
      ['2026-06-01T09:00:00.000Z', '  Some other line ', '{}'],
      response('2026-06-01T09:00:01.000Z'),
      'test-run-uuid'
    );

    assert.strictEqual(this.captured.length, 0);
  });
});
