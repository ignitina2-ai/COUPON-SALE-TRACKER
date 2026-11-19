<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/dfea9a9b-0b0d-4e72-96f5-ba3821d75bbb

## Windows desktop app and automatic updates

Install dependencies and build a Windows installer:

```powershell
npm ci
npm run desktop:build
```

The NSIS installer is written to `release/`. The packaged app checks GitHub Releases when it starts, downloads a newer version automatically, and asks whether to restart and install it.

The Windows app serves its packaged files on a local `localhost` origin so Firebase Google Sign-In does not run from `file://`. In Firebase Console, confirm `localhost` is listed under Authentication > Settings > Authorized domains.

To publish an update, increment the version in `package.json` (and `package-lock.json`), commit the change, then push a matching `v` tag:

```powershell
npm version patch
git push origin HEAD --follow-tags
```

For each release, also set `versionName` in `android/app/build.gradle` to match the package version and increment `versionCode`.

The `Release apps` GitHub Actions workflow builds the Windows installer and Android APK, then publishes both to this repository's GitHub Release. The Android APK is debug-signed for direct installation; it is not a Play Store release. The repository must be public for end users to download Windows updates without embedding a private access token. Installers are unsigned unless a Windows code-signing certificate is configured.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
