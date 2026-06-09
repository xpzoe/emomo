# emomo

Expo Go MVP for iPhone, plus a lightweight browser test version.

## Run Expo

```powershell
npm install
npx expo start
```

Open Expo Go on your iPhone and scan the QR code.

## Run Web Test Version

Open `docs/index.html` directly in a browser for local-only testing, or serve it locally:

```powershell
python -m http.server 5173 -d docs
```

Then visit `http://localhost:5173`.

## Supabase Sync

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Copy your Project URL and anon public key into `docs/supabase-config.js`.
4. Open the web app, go to Settings, enter your email, and send a login link.

The web version keeps working locally when Supabase is not configured. After login, local records are uploaded and remote records are merged back into browser storage.

For Supabase login and sync, use `http://localhost:5173` instead of opening `docs/index.html` with `file://`.

## Deploy Web With GitHub Pages

GitHub Pages can serve the static web app from the `docs/` folder.

1. Push this repo to GitHub.
2. Open the repo on GitHub.
3. Go to `Settings -> Pages`.
4. Choose `Deploy from a branch`.
5. Select branch `emomo-v1`.
6. Select folder `/docs`.
7. Save.

The site URL should be:

```text
https://xpzoe.github.io/emomo/
```

Add that URL to Supabase Auth URL configuration before using email login in production.

## One-Tap Web Shortcuts

The deployed web app supports direct mood capture URLs:

```text
https://xpzoe.github.io/emomo/?mood=happy
https://xpzoe.github.io/emomo/?mood=angry
https://xpzoe.github.io/emomo/?mood=sad
https://xpzoe.github.io/emomo/?mood=down
https://xpzoe.github.io/emomo/?mood=calm
https://xpzoe.github.io/emomo/?mood=tired
```

Opening one of these URLs records that mood immediately, shows the saved animation, uploads to Supabase if signed in, and cleans the URL to avoid duplicate records on refresh.

On iPhone, create a Shortcut with the action `Open URLs`, paste one of these URLs, then add the shortcut to the Home Screen.

## Supabase Sync In Expo

Copy `.env.example` to `.env` and fill in:

```powershell
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

In Supabase Auth URL configuration, add the redirect URL:

```text
emomo://auth
```

Then restart Expo. In the app, open Settings, send a login link to your email, open the link on the iPhone, and tap Sync.

## What It Includes

- Six-mood one-tap capture
- Expo Haptics feedback
- Particle burst animation with React Native `Animated`
- Local JSON file storage via `expo-file-system`
- Custom local reminder times and reminder message
- Range-based pixel canvas: 7 days, 30 days, 90 days, 12 months
- Recent timeline and quick capture rail
- Mood weather analysis with regulation tips
- Local weather snapshot saved into records when location permission is available

The web test version mirrors the latest product flow with `localStorage`, browser vibration, CSS particles, browser notifications, geolocation, and Open-Meteo weather.

## Note

iOS does not allow normal apps to programmatically close themselves. After a record, emomo shows a 500ms completion overlay and stays ready for the next capture.
