# MoodBullet Expo

Expo Go MVP for iPhone.

## Run

```powershell
npm install
npx expo start
```

Open Expo Go on your iPhone and scan the QR code.

## What It Includes

- One-tap emoji mood capture
- Expo Haptics feedback
- Particle burst animation with React Native `Animated`
- Local JSON file storage via `expo-file-system`
- Daily local notifications at 15:00 and 21:00 via `expo-notifications`
- 12-month pixel canvas history view

## Note

iOS does not allow normal apps to programmatically close themselves. After a record, MoodBullet shows a 500ms completion overlay and stays ready for the next capture.
