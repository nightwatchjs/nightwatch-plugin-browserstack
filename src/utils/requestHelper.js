const {API_URL, SCREENSHOT_EVENT_URL} = require('./constants');
const http = require('node:http');
const https = require('node:https');
const request = require('@cypress/request');

function createKeepAliveAgent(protocol) {
  return new protocol.Agent({
    keepAlive: true,
    timeout: 45000,
    maxSockets: 2,
    maxTotalSockets: 2
  });
}

const httpKeepAliveAgent = createKeepAliveAgent(http);
const httpsKeepAliveAgent = createKeepAliveAgent(https);
const httpScreenshotsKeepAliveAgent = createKeepAliveAgent(http);
const httpsScreenshotsKeepAliveAgent = createKeepAliveAgent(https);

exports.makeRequest = (type, url, data, config, requestUrl=API_URL, jsonResponse = true) => {
  const isHttps = requestUrl.includes('https');
  let agent;
  if (url === SCREENSHOT_EVENT_URL) {
    agent = isHttps ? httpsScreenshotsKeepAliveAgent : httpScreenshotsKeepAliveAgent;
  } else {
    agent = isHttps ? httpsKeepAliveAgent : httpKeepAliveAgent;
  }
  
  const options = {
    ...config,
    method: type,
    url: `${requestUrl}/${url}`,
    body: data,
    json: config.headers['Content-Type'] === 'application/json',
    agent
  };

  return new Promise((resolve, reject) => {
    request(options, function callback(error, response, body) {
      if (error) {
        reject(error);
      } else if (response.statusCode !== 200 && response.statusCode !== 201) {
        reject(response && response.body ? response.body : `Received response from BrowserStack Server with status : ${response.statusCode}`);
      } else {
        if (jsonResponse) {
          try {
            if (body && typeof(body) !== 'object') {body = JSON.parse(body)}
          } catch (e) {
            reject('Not a JSON response from BrowserStack Server');
          }
        }
        resolve({
          data: body
        });
      }
    });
  });
};
