const path = require('path');
const fs = require('fs');

const helper = require('./helper');

class Scripts {
  constructor() {
    this.performScan = null;
    this.getResults = null;
    this.getResultsSummary = null;
    this.saveTestResults = null;

    this.browserstackFolderPath = path.join(helper.homedir(), '.browserstack');
    this.commandsPath = path.join(this.browserstackFolderPath, 'commands.json');

    this.fromJson();
  }

  parseFromJson(responseData) {
    if (responseData.scripts) {
      this.performScan = responseData.scripts.scan;
      this.getResults = responseData.scripts.getResults;
      this.getResultsSummary = responseData.scripts.getResultsSummary;
      this.saveTestResults = responseData.scripts.saveResults;
    }

    this.commandsToWrap = responseData.commands;
  }

  shouldWrapCommand(method) {
    try {
      return this.commandsToWrap.findIndex(el => el.name.toLowerCase() === method.toLowerCase()) !== -1;
    } catch { /* empty */ }

    return false;
  }

  toJson() {
    if (!fs.existsSync(this.browserstackFolderPath)){
      fs.mkdirSync(this.browserstackFolderPath);
    }

    fs.writeFileSync(this.commandsPath, JSON.stringify({
      scripts: {
        scan: this.performScan,
        getResults: this.getResults,
        getResultsSummary: this.getResultsSummary,
        saveResults: this.saveTestResults
      },
      commands: this.commandsToWrap
    }));
  }

  fromJson() {
    if (fs.existsSync(this.commandsPath)) {
      this.parseFromJson(require(this.commandsPath));
    }
  }
}

module.exports = new Scripts();
