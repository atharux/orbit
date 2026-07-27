# Signing & notarizing Orbit.app (macOS, direct distribution)

This produces a `.app`/`.dmg` that opens on **any** Mac with **no Gatekeeper
warning** — Developer ID + notarization, *not* the App Store (no 30% cut, no
review). The Tauri config already declares hardened-runtime entitlements
(`entitlements.plist`); you just add the certificate + credentials.

## One-time setup

1. **Apple Developer Program** — $99/yr at <https://developer.apple.com/programs/>.
2. **Developer ID Application certificate** — in Xcode: *Settings → Accounts →
   Manage Certificates → + → Developer ID Application*. It installs into your
   login Keychain. Confirm it's there:
   ```bash
   security find-identity -v -p codesigning
   # look for: "Developer ID Application: Your Name (TEAMID)"
   ```
3. **App-specific password** for notarization — create one at
   <https://appleid.apple.com> → Sign-In & Security → App-Specific Passwords.
4. **Team ID** — the `(TEAMID)` in the identity above, also on your Apple
   Developer membership page.

## Build (signed + notarized + stapled)

Set these env vars, then run the normal build — Tauri signs, uploads to Apple's
notary service, waits, and staples the ticket automatically:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="abcd-efgh-ijkl-mnop"   # the app-specific password
export APPLE_TEAM_ID="TEAMID"

npm run tauri:build
```

Output: `src-tauri/target/release/bundle/macos/Orbit.app` (signed + notarized)
and a `.dmg` beside it.

## Verify it will open cleanly elsewhere

```bash
APP=src-tauri/target/release/bundle/macos/Orbit.app
codesign --verify --deep --strict --verbose=2 "$APP"
spctl -a -vvv -t exec "$APP"        # expect: "accepted ... source=Notarized Developer ID"
xcrun stapler validate "$APP"        # expect: "The validate action worked!"
```

## Notes

- **Without** these env vars, `npm run tauri:build` still produces a working
  (adhoc-signed) `Orbit.app` — fine for your own USB, but other Macs need
  *right-click → Open* the first time. Notarization removes that.
- **Windows / Intel** are separate builds (built on those targets or via CI).
- The app ships with **no secrets** (see `.env.production`); users enter their
  own OpenRouter key in Settings, and the graph runs on local data without Aura.
