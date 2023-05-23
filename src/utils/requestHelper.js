const {API_URL, SCREENSHOT_EVENT_URL} = require('./constants');
const http = require('node:http');
const https = require('node:https');
const request = require('request');

function createKeepAliveAgent(protocol) {
  return new protocol.Agent({
    keepAlive: true,
    timeout: 60000,
    maxSockets: 2,
    maxTotalSockets: 2
  });
}

const httpKeepAliveAgent = createKeepAliveAgent(http);
const httpsKeepAliveAgent = createKeepAliveAgent(https);
const httpScreenshotsKeepAliveAgent = createKeepAliveAgent(http);
const httpsScreenshotsKeepAliveAgent = createKeepAliveAgent(https);

exports.makeRequest = (type, url, data, config) => {
  
  return new Promise((resolve, reject) => {
    const options = {...config, ...{
      method: type,
      url: `${API_URL}/${url}`,
      body: data,
      json: config.headers['Content-Type'] === 'application/json',
      agent: API_URL.includes('https') ? httpsKeepAliveAgent : httpKeepAliveAgent
    }};

    if (url === SCREENSHOT_EVENT_URL) {
      options.agent = API_URL.includes('https') ? httpsScreenshotsKeepAliveAgent : httpScreenshotsKeepAliveAgent;
    }

    request(options, function callback(error, response, body) {
      if (error) {
        reject(error);
      } else if (response.statusCode !== 200) {
        if (response.statusCode === 401) {
          reject(response && response.body ? response.body : `Received response from BrowserStack Server with status : ${response.statusCode}`);
        } else {
          reject(`Received response from BrowserStack Server with status : ${response.statusCode}`);
        }
      } else {
        try {
          if (body && typeof(body) !== 'object') {body = JSON.parse(body)}
        } catch (e) {
          reject('Not a JSON response from BrowserStack Server');
        }
        resolve({
          data: body
        });
      }
    });
  });
};
