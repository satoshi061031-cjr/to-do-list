# Daily Space Today widget

Native WidgetKit extension for iOS 15+, available in small and medium Home Screen sizes. The small widget shows today's remaining count and completion progress; medium also shows up to three upcoming open tasks. Both open `todo-m.html#today` through `dailyspace://today`.

The target is embedded in the existing Capacitor app. This is not a Safari/PWA widget. Safari Guest and native App Guest use separate local storage. Use the existing Google account sync or Import & backup to bring tasks into the native app; installing the app does not read Safari's local data.

## Data and refresh

The app writes a bounded read-only snapshot into its App Group and requests `WidgetCenter` refreshes after task, account and locale changes. No widget networking, credentials, email content, task notes or checklist contents are included. Only due dates, title previews, times and aggregate completion counts for today and the next seven days are shared. Unauthenticated Guest data stays on the device. During sign-in/account switching the widget receives an empty not-ready snapshot until the correct personal snapshot has loaded.

WidgetKit schedules the actual refresh. Updates are not guaranteed to appear instantly. Midnight timeline entries advance the cached day while the app is closed; they do not fetch edits from another device. An expired/missing cache asks the user to open the app, rather than showing a fabricated empty day. The footer shows the last app update time. Opening the app while the account is offline/not yet synced does not publish unverified account contents.

The widget is read-only. Tapping opens Today; completing tasks happens in the app. Home Screen task previews are marked `privacySensitive`, with actual visibility controlled by iOS.

## Mac and signing setup

1. Install the Xcode/toolchain required by the repository's Capacitor version. Run `npm ci` and `npm run test:widget` from the repository root.
2. For a production device build, set `CAPACITOR_SERVER_URL` to the deployed HTTPS origin containing this version of `theme.js` and `native-widget.js`, then run `npm run cap:sync` and open `ios/App/App.xcodeproj`.
3. In **App** and **DailySpaceWidget → Signing & Capabilities**, select the same Apple development team. The repository retains the existing team setting. Register/enable the same App Group for both application identifiers and provisioning profiles. The default is `group.app.dailyspace.mobile`, supplied by the `DAILY_SPACE_APP_GROUP` build setting and both entitlements. App Groups require an Apple account with the necessary developer capabilities; a free Personal Team may not support them. This repository does not register identifiers or purchase a developer membership.
4. If changing identifiers, keep the widget bundle ID under the App's prefix (defaults: `app.dailyspace.mobile` and `app.dailyspace.mobile.Today`), and set the same App Group in both targets/build configurations. Regenerate profiles if needed.
5. Run the **App** scheme on an iPhone. Launch once, add a dated task for today, return to the Home Screen, long-press → **Edit / Add Widget → Daily Space**, and choose small or medium.

The project contains an explicit extension target, an App dependency and an Embed App Extensions build phase. `npm run cap:sync` should preserve these tracked native files; inspect the native diff when upgrading Capacitor. Widget colors and the unchanged ghost image come from `DESIGN.md` and `welcome-sticker.png`; rerun `node scripts/prepare-widget-assets.js` after design token changes.

## Build and device checks

Unsigned simulator compile on a Mac (after `npm run cap:sync`):

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/daily-space-derived \
  CODE_SIGNING_ALLOWED=NO build
```

A manual **iOS app and widget build** GitHub Actions workflow runs the same compile on a macOS runner. It is not triggered on push and does not publish an app. Neither that workflow nor the Xcode build has been executed in the Linux coding environment; passing JavaScript tests or parsing the Xcode project does not establish a successful native build.

Before shipping, verify on the signed device:

- Small/medium, light/dark, and the smallest supported phone; long Chinese/English titles stay readable without overlapping counts or times.
- Create, complete, undo, edit a due date and change language in the app; the widget refresh request contains the updated snapshot. Check the actual WidgetKit refresh delay separately.
- Switch Google accounts/sign out; the shared cache clears before the next account is ready. Check the OS-rendered preview as well, since repainting remains system-scheduled.
- Kill the app, tap the widget, then tap again while the app is open on another page; both routes land in Today once.
- Leave the app closed across midnight. Check the next cached day and behavior after the cache expires. Verify DST/time-zone changes separately.
- Open in airplane mode; the existing widget cache remains readable while the app is closed. Missing/unverified account data shows the open-app prompt.

Native build, provisioning, real WidgetKit sizing and physical iPhone behavior remain Mac/device checks. Web and bridge tests do not replace them.
