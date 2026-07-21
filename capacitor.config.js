const { existsSync } = require("node:fs");

/**
 * Native shell for Daily Space.
 *
 * Production / device builds should set CAPACITOR_SERVER_URL to your HTTPS
 * deploy (same as MAIL_OAUTH_BASE_URL) so OAuth cookies and /api work.
 * Example: CAPACITOR_SERVER_URL=https://your-app.onrender.com
 *
 * Without CAPACITOR_SERVER_URL, the app loads bundled files from www/
 * (useful for UI smoke tests; API/OAuth need the live server URL).
 */
const serverUrl = String(process.env.CAPACITOR_SERVER_URL || "")
  .trim()
  .replace(/\/+$/, "");

/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: "app.dailyspace.mobile",
  appName: "Daily Space",
  webDir: "www",
  bundledWebRuntime: false,
  backgroundColor: "#e7e9ea",
  server: {
    androidScheme: "https",
    // Keep OAuth redirects inside the WebView when possible.
    allowNavigation: [
      "accounts.google.com",
      "*.google.com",
      "*.googleusercontent.com",
      "login.microsoftonline.com",
      "*.microsoftonline.com",
      "*.microsoft.com",
      "open.weixin.qq.com",
      "*.weixin.qq.com",
      "api.weixin.qq.com",
    ],
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 400,
      backgroundColor: "#e7e9ea",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#e7e9ea",
    },
  },
};

if (serverUrl) {
  config.server.url = serverUrl;
}

if (!existsSync("www") && !serverUrl) {
  console.warn(
    "[capacitor] www/ missing and CAPACITOR_SERVER_URL unset — run npm run cap:prepare first."
  );
}

module.exports = config;
