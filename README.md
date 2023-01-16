# @nightwatch/browserstack

<p align=center>
  <img alt="Nightwatch.js Logo" src=".github/assets/nightwatch-logo.png" width=200 />
  <img src=".github/assets/browserstack-square.jpeg" width=200> 
</p>


Official Nightwatch plugin for integration with the BrowserStack Local tunnel.

```
npm i @nightwatch/browserstack --save-dev
```

## Usage:

Update your [Nightwatch configuration](https://nightwatchjs.org/guide/configuration/overview.html) and add the plugin to the list:

```js
module.exports = {
  plugins: ['@nightwatch/browserstack'],
  
  // browserstack plugin settings...
  '@nightwatch/browserstack': {
    browserstackLocal: true, // set true to manage browserstack local tunnel. Defaults to false.
    browserstackLocalOptions: {
      // other browserstack local options
    }
  },

  // other nightwatch settings...
}
```
## License
MIT
