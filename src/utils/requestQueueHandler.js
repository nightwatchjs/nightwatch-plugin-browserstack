const {BATCH_SIZE, BATCH_INTERVAL} = require('./constants');
const Logger = require('./logger');
const {makeRequest} = require('./requestHelper');

class RequestQueueHandler {
  constructor() {
    this.queue = [];
    this.started = false;
    this.eventUrl = 'api/v1/batch';
    this.screenshotEventUrl = 'api/v1/screenshots';
    this.BATCH_EVENT_TYPES = ['LogCreated', 'TestRunFinished', 'TestRunSkipped', 'HookRunFinished', 'TestRunStarted', 'HookRunStarted'];
    this.pollEventBatchInterval = null;
    RequestQueueHandler.pending_test_uploads = 0;
  }

  start() {
    if (!this.started) {
      this.started = true;
      this.startEventBatchPolling();
    }
  }

  add (event) {
    if (this.BATCH_EVENT_TYPES.includes(event.event_type)) {
      if (event.logs && event.logs[0] && event.logs[0].kind === 'TEST_SCREENSHOT') {
        return {
          shouldProceed: true,
          proceedWithData: [event],
          proceedWithUrl: this.screenshotEventUrl
        };
      }

      this.queue.push(event);
      let data = null;
      const shouldProceed = this.shouldProceed();
      if (shouldProceed) {
        data = this.queue.slice(0, BATCH_SIZE);
        this.queue.splice(0, BATCH_SIZE);
        this.resetEventBatchPolling();
      }

      return {
        shouldProceed: shouldProceed,
        proceedWithData: data,
        proceedWithUrl: this.eventUrl
      };
    }
 
    return {
      shouldProceed: true
    };
    
  }

  async shutdown () {
    this.removeEventBatchPolling('REMOVING');
    while (this.queue.length > 0) {
      const data = this.queue.slice(0, BATCH_SIZE);
      this.queue.splice(0, BATCH_SIZE);
      await this.batchAndPostEvents(this.eventUrl, 'Shutdown-Queue', data);
    }
  }

  startEventBatchPolling () {
    this.pollEventBatchInterval = setInterval(async () => {
      if (this.queue.length > 0) {
        const data = this.queue.slice(0, BATCH_SIZE);
        this.queue.splice(0, BATCH_SIZE);
        await this.batchAndPostEvents(this.eventUrl, 'Interval-Queue', data);
      }
    }, BATCH_INTERVAL);
  }

  resetEventBatchPolling () {
    this.removeEventBatchPolling('RESETTING');
    this.startEventBatchPolling();
  }

  removeEventBatchPolling (tag) {
    if (this.pollEventBatchInterval) {
      clearInterval(this.pollEventBatchInterval);
      this.pollEventBatchInterval = null;
      if (tag === 'REMOVING') {
        this.started = false;
      }
    }
  }

  shouldProceed () {
    return this.queue.length >= BATCH_SIZE;
  }

  async batchAndPostEvents (eventUrl, kind, data) {
    const config = {
      headers: {
        'Authorization': `Bearer ${process.env.BS_TESTOPS_JWT}`,
        'Content-Type': 'application/json',
        'X-BSTACK-TESTOPS': 'true'
      }
    };
  
    try {
      const response = await makeRequest('POST', eventUrl, data, config);
      if (response.data.error) {
        throw ({message: response.data.error});
      } else {
        this.pending_test_uploads = Math.max(0, this.pending_test_uploads - data.length);
      }
    } catch (error) {
      if (error.response) {
        Logger.error(`EXCEPTION IN ${kind} REQUEST TO TEST OBSERVABILITY : ${error.response.status} ${error.response.statusText} ${JSON.stringify(error.response.data)}`);
      } else {
        Logger.error(`EXCEPTION IN ${kind} REQUEST TO TEST OBSERVABILITY : ${error.message || error}`);
      }
      this.pending_test_uploads = Math.max(0, this.pending_test_uploads - data.length);
    }
  };
}

module.exports = new RequestQueueHandler();
