const assert = require('assert');
const http = require('http');
const sinon = require('sinon');

const requestHelper = require('../../../src/utils/requestHelper');

// Every request on the LT stop path carries its own timeout under the flush deadline.
// The request library's own `timeout` only bounds the connect and the gaps between bytes, so a
// response that trickles in never trips it; makeRequest bounds the whole call instead.
const QUEUE_HANDLER_PATH = require.resolve('../../../src/utils/requestQueueHandler');

const startServer = (onRequest) => new Promise((resolve) => {
  const server = http.createServer(onRequest);
  server.listen(0, '127.0.0.1', () => resolve(server));
});

const stopServer = (server) => new Promise((resolve) => {
  server.closeAllConnections();
  server.close(() => resolve());
});

describe('makeRequest - per-request timeout', function () {
  let server;
  let trickle;

  afterEach(async function () {
    clearInterval(trickle);
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it('rejects a trickling response at the wall-clock timeout', async function () {
    server = await startServer((req, res) => {
      res.writeHead(200, {'Content-Type': 'application/json'});
      trickle = setInterval(() => res.write(' '), 50);
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    const startedAt = Date.now();

    const outcome = await Promise.race([
      requestHelper.makeRequest('POST', 'api/v1/batch', [], {headers: {'Content-Type': 'application/json'}, timeout: 300}, url)
        .then(() => 'resolved', (error) => error),
      new Promise((resolve) => setTimeout(() => resolve('still pending'), 1500))
    ]);

    assert.ok(outcome instanceof Error, `expected a timeout rejection, got: ${outcome}`);
    assert.match(outcome.message, /timed out after 300ms/);
    assert.ok(Date.now() - startedAt < 1500, 'rejected within the bound');
  });

  it('resolves as today when no timeout is set', async function () {
    server = await startServer((req, res) => {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end('{}');
    });
    const url = `http://127.0.0.1:${server.address().port}`;

    const response = await requestHelper.makeRequest('POST', 'api/v1/batch', [], {headers: {'Content-Type': 'application/json'}}, url);

    assert.deepStrictEqual(response.data, {});
  });
});

describe('requestQueueHandler.shutdown - drain timeout', function () {
  let sandbox;
  let originalModule;
  let queueHandler;
  let makeRequestStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    makeRequestStub = sandbox.stub(requestHelper, 'makeRequest').resolves({data: {}});
    // requestQueueHandler destructures makeRequest at load time, so load a fresh copy over the
    // stub and put the shared singleton back afterwards.
    originalModule = require.cache[QUEUE_HANDLER_PATH];
    delete require.cache[QUEUE_HANDLER_PATH];
    queueHandler = require(QUEUE_HANDLER_PATH);
  });

  afterEach(function () {
    queueHandler.removeEventBatchPolling('REMOVING');
    require.cache[QUEUE_HANDLER_PATH] = originalModule;
    sandbox.restore();
  });

  it('passes the timeout to every drain POST', async function () {
    for (let i = 0; i < 1001; i++) {
      queueHandler.queue.push({event_type: 'TestRunFinished', test_run: {uuid: `u-${i}`}});
    }

    await queueHandler.shutdown(1500);

    sinon.assert.calledTwice(makeRequestStub);
    makeRequestStub.getCalls().forEach((call) => {
      assert.strictEqual(call.args[3].timeout, 1500);
    });
    assert.strictEqual(queueHandler.queue.length, 0);
  });

  it('sends no timeout key when called without one', async function () {
    queueHandler.queue.push({event_type: 'TestRunStarted', test_run: {uuid: 'u-1'}});

    await queueHandler.shutdown();

    sinon.assert.calledOnce(makeRequestStub);
    assert.ok(!('timeout' in makeRequestStub.firstCall.args[3]), 'config unchanged for the non-LT path');
  });
});

describe('helper.shutDownRequestHandler - drain timeout', function () {
  it('passes the timeout to the shared queue handler', async function () {
    const helper = require('../../../src/utils/helper');
    const sharedQueueHandler = require(QUEUE_HANDLER_PATH);
    const shutdownStub = sinon.stub(sharedQueueHandler, 'shutdown').resolves();
    try {
      await helper.shutDownRequestHandler(1500);
      sinon.assert.calledOnceWithExactly(shutdownStub, 1500);
    } finally {
      shutdownStub.restore();
    }
  });
});
