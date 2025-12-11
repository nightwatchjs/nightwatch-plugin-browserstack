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
   git tag v3.7.0
   ```
10. Push commits **and tags**:  
    ```sh
    git push origin main --tags
    ```
11. **Login to npm (if not already authenticated):**  
    ```sh
    npm login
    ```
    _Requires an npm account with permission for this package (typically by joining the Nightwatch organization on npm). For accounts with 2FA, a mobile verification code will be requested._
12. **Publish the package to npm:**  
    ```sh
    npm publish
    ```
13. **Create a release on GitHub:**  
    - Select the new tag.
    - Generate release notes.
    - Publish the release.
