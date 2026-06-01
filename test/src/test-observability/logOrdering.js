const {expect} = require('chai');
const sinon = require('sinon');
const helper = require('../../../src/utils/helper');
const TestObservability = require('../../../src/testObservability');
const logSequence = require('../../../src/utils/logSequence');

// SDK-6164: TRA log timestamp ordering.
// 1. HTTP logs must be stamped with the request-issued time (httpRequest[0]),
//    not the response-received time, so a slow request does not sort after
//    logs that were emitted while it was still in flight.
// 2. Every LogCreated log carries a per-process monotonic `sequence` so the
//    backend has a deterministic tiebreaker for same-millisecond timestamps.
describe('TestObservability - log ordering (SDK-6164)', function () {
  beforeEach(() => {
    this.sandbox = sinon.createSandbox();
    this.testObservability = new TestObservability();
    this.captured = [];
    this.sandbox.stub(helper, 'uploadEventData').callsFake(async (e) => {
      this.captured.push(e.logs[0]);
    });
    logSequence._reset();
  });

  afterEach(() => {
    this.sandbox.restore();
  });

  it('stamps HTTP logs with the request-issued time, not the response time', async () => {
    const httpRequest = ['2026-06-01T09:00:00.000Z', 'Request POST /session/1/url', 'body'];
    const httpResponse = ['2026-06-01T09:00:05.000Z', 'Response 200 OK', 'resp'];

    await this.testObservability.createHttpLogEvent(httpRequest, httpResponse, 'uuid');

    const log = this.captured[0];
    expect(log.timestamp).to.equal('2026-06-01T09:00:00.000Z'); // request time
    expect(log.timestamp).to.not.equal('2026-06-01T09:00:05.000Z'); // not response time
    // duration is still measured request->response
    expect(log.http_response.duration_ms).to.equal(5000);
  });

  it('keeps emission order on the wire after server-side (timestamp, sequence) sort', async () => {
    // R1 issued first but slow (5s); R2 issued 1s later but fast.
    await this.testObservability.createHttpLogEvent(
      ['2026-06-01T09:00:00.000Z', 'Request POST /session/1/url', 'b1'],
      ['2026-06-01T09:00:05.000Z', 'Response 200 OK', 'r1'], 'uuid');
    await this.testObservability.createHttpLogEvent(
      ['2026-06-01T09:00:01.000Z', 'Request POST /session/1/element', 'b2'],
      ['2026-06-01T09:00:01.100Z', 'Response 200 OK', 'r2'], 'uuid');

    const sorted = [...this.captured].sort((a, b) => {
      if (a.timestamp !== b.timestamp) {return a.timestamp < b.timestamp ? -1 : 1}

      return a.sequence - b.sequence;
    });
    expect(sorted.map(l => l.http_response.path)).to.deep.equal(['/session/1/url', '/session/1/element']);
  });

  it('assigns a deterministic monotonic sequence so same-ms logs never tie', async () => {
    const tie = '2026-06-01T09:00:02.000Z';
    await this.testObservability.createHttpLogEvent(
      [tie, 'Request GET /tie/a', 'b3'], [tie, 'Response 200 OK', 'r3'], 'uuid');
    await this.testObservability.createHttpLogEvent(
      [tie, 'Request GET /tie/b', 'b4'], [tie, 'Response 200 OK', 'r4'], 'uuid');

    const a = this.captured[0];
    const b = this.captured[1];
    expect(a.timestamp).to.equal(b.timestamp); // genuine same-ms tie
    expect(a.sequence).to.be.a('number');
    expect(b.sequence).to.be.a('number');
    expect(b.sequence).to.be.greaterThan(a.sequence); // tie broken deterministically
  });

  it('shares one per-process sequence across log kinds (HTTP + screenshot)', async () => {
    await this.testObservability.createScreenshotLogEvent('uuid', 'base64data', Date.now());
    await this.testObservability.createHttpLogEvent(
      ['2026-06-01T09:00:00.000Z', 'Request GET /x', 'b'],
      ['2026-06-01T09:00:00.001Z', 'Response 200 OK', 'r'], 'uuid');

    expect(this.captured[0].sequence).to.equal(0);
    expect(this.captured[1].sequence).to.equal(1);
  });
});
