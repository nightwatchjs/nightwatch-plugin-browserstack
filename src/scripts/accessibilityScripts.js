const path = require('path');
const fs = require('fs');
const os = require('os');

class AccessibilityScripts {
  static instance = null;

  performScan = null;
  getResults = null;
  getResultsSummary = null;
  saveTestResults = null;
  commandsToWrap = null;
  ChromeExtension = {};

  browserstackFolderPath = '';
  commandsPath = '';

  // don't allow to create instances from it other than through `checkAndGetInstance`
  constructor() {
    this.browserstackFolderPath = this.getWritableDir();
    this.commandsPath = path.join(this.browserstackFolderPath, 'commands.json');
  }

  static checkAndGetInstance() {
    if (!AccessibilityScripts.instance) {
      AccessibilityScripts.instance = new AccessibilityScripts();
      AccessibilityScripts.instance.readFromExistingFile();
    }

    return AccessibilityScripts.instance;
  }

  getWritableDir() {
    const orderedPaths = [
      path.join(os.homedir(), '.browserstack'),
      process.cwd(),
      os.tmpdir()
    ];
    for (const orderedPath of orderedPaths) {
      try {
        if (fs.existsSync(orderedPath)) {
          fs.accessSync(orderedPath);

          return orderedPath;
        }

        fs.mkdirSync(orderedPath, {recursive: true});

        return orderedPath;

      } catch (e) {
        /* no-empty */
      }
    }

    return '';
  }

  readFromExistingFile() {
    try {
      if (fs.existsSync(this.commandsPath)) {
        const data = fs.readFileSync(this.commandsPath, 'utf8');
        if (data) {
          this.update(JSON.parse(data));
        }
      }
    } catch (error) {
      /* Do nothing */
    }
  }

  update(data) {
    if (data.scripts) {
      this.performScan = data.scripts.scan;
      this.getResults = data.scripts.getResults;
      this.getResultsSummary = data.scripts.getResultsSummary;
      this.saveTestResults = data.scripts.saveResults;
    }
    if (data.commands && data.commands.length) {
      this.commandsToWrap = data.commands;
    }
  }

  store() {
    if (!fs.existsSync(this.browserstackFolderPath)){
      fs.mkdirSync(this.browserstackFolderPath);
    }

    fs.writeFileSync(this.commandsPath, JSON.stringify({
      commands: this.commandsToWrap,
      scripts: {
        scan: this.performScan,
        getResults: this.getResults,
        getResultsSummary: this.getResultsSummary,
        saveResults: this.saveTestResults
      }
    }));
  }
}

module.exports = AccessibilityScripts.checkAndGetInstance();
