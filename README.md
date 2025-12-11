# @nightwatch/browserstack

<p align=center>
  <img alt="Nightwatch.js Logo" src=".github/assets/nightwatch-logo.png" width=200 />
  <img src=".github/assets/browserstack-square.jpeg" width=200> 
</p>


Official Nightwatch plugin for integration with the BrowserStack.

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
    },
    test_observability: {
      enabled: true, // set true for enabling browserstack test observability
      user: '${BROWSERSTACK_USERNAME}',
      key: '${BROWSERSTACK_ACCESS_KEY}',
      projectName: "BrowserStack Samples",
      buildName: "browserstack build"
    }
  },

  // other nightwatch settings...
}
```

## Release Process

Follow these steps when releasing the Nightwatch Browserstack plugin:

1. **Merge the corresponding pull request (PR)** using squash and merge.
2. **Clone a fresh copy of the repository locally** to avoid publishing uncommitted files.
3. Run `npm install` (or `npm i`) to install dependencies.
4. Run `npm audit fix` to automatically resolve fixable vulnerabilities.  
   _Note: This only changes `package-lock.json`. It is safer than using `--force`, which may change package versions unexpectedly._
5. **Commit and push** any changes resulting from `npm audit fix`.
6. **Bump the version** in `package.json` (e.g., `3.6.2` → `3.7.0` for a minor bump).
7. Run `npm install` again to update `package-lock.json` after the version bump.
8. **Stage and commit** the version bump changes.  
   _Release commit names should match the version number, e.g., `3.7.0`._
9. Add a tag:  
   ```sh
   git tag 3.7.0
   ```
10. Push commits **and tags**:  
    ```sh
    git push --tags
    ```
11. **Publish the package:**  
    ```sh
    npm publish
    ```
    _Requires an npm account with permission for this package (typically by joining the Nightwatch organization on npm). For accounts with 2FA, a mobile verification code will be requested._
12. **Create a release on GitHub:**  
    - Select the new tag.
    - Generate release notes.
    - Publish the release.

## License
MIT
