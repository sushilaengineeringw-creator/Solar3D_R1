# Solar 3D – rooftop solar viewer (Three.js + Supabase Realtime + Capacitor)

Shows a customer a 3D house with solar panels on the roof. Change panel count, roof tilt
and time of day; the sun and shadows update live. Several phones can join the same room
code and see the same view in real time.

## Folder layout
```
solar3d/
├─ .github/workflows/build-apk.yml   # builds the APK on GitHub (free runner)
├─ src/
│  ├─ main.js                        # 3D scene, controls, UI logic
│  ├─ sync.js                        # Supabase Realtime (or same-device fallback)
│  └─ style.css                      # Tailwind + mobile touch rules
├─ index.html
├─ capacitor.config.json
├─ vite.config.js / tailwind.config.js / postcss.config.js
├─ package.json  (+ package-lock.json)
├─ .env.example  → copy to .env for local dev
└─ .gitignore
```
The `android/` folder is created automatically by the workflow (or by `npx cap add android`).

## Run on your PC
```
npm install
cp .env.example .env     # optional, see Supabase below
npm run dev
```
Without Supabase keys the app still works; sync only works between browser tabs on the same device.

## Supabase (free) – 3 minutes
1. supabase.com → New project (free plan).
2. Project Settings → API → copy **Project URL** and **anon public key**.
3. Put them in `.env` (local) and in GitHub → Settings → Secrets and variables → Actions:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
4. No tables needed. The app uses Realtime Broadcast + Presence only.
   (Free tier limits: ~200 concurrent connections, ~2M messages/month.)

## Build the APK on GitHub
1. Push this folder to a GitHub repository (branch `main`).
2. Add the two secrets above.
3. Actions tab → "Build Android APK" runs on every push (or Run workflow).
4. Open the finished run → Artifacts → download `solar3d-debug-apk` → unzip → install the .apk on your phone
   (allow "install unknown apps").

Release (Play Store style) build: Run workflow → choose `release`, after adding secrets
`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`.
Create a keystore once with:
```
keytool -genkey -v -keystore release.keystore -alias solar -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.keystore      # paste output into KEYSTORE_BASE64
```

## Local Android build (optional)
```
npm run build
npx cap add android      # first time only
npx cap sync android
npx cap open android     # opens Android Studio
```
