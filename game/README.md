# Night Bite Diner

An original iPhone game: you run a diner that only opens after midnight, staffed by friendly zombies.

- **Cook:** tap a stove and pick a dish. Longer dishes make more servings and earn more.
- **Your zombies do the rest:** they carry finished food to the serving counter, serve guests and wipe tables.
- **Guests have patience:** feed them before their bar runs out. Happy guests pay coins and raise your star rating; guests who wait too long walk out and lower it.
- **Espresso:** zombies get sleepy and slow down. Tap ☕ Coffee (or a zombie in the Staff sheet) to wake them.
- **Grow:** buy stoves, counters and tables, add spooky decor (more patient guests, bigger tips), hire more zombies, level up to unlock new dishes.
- **Build mode (🔨):** tap anything to move or sell it. Layouts that would block the way in are refused.

Stoves keep cooking while the app is closed, and the game saves itself every few seconds.

## Play it on your iPhone (no Mac needed)

1. Install **Expo Go** from the App Store.
2. On your computer, from this folder:
   ```bash
   npm install
   npx expo start
   ```
3. Scan the QR code with the iPhone camera. The phone and computer must be on the same Wi-Fi
   (or run `npx expo start --tunnel` instead).

`npx expo start --web` runs it in a browser too.

## Checks

```bash
npm run typecheck   # TypeScript
npm run sim         # plays two in-game hours headlessly with a bot and checks the bookkeeping
```

## Putting it on the App Store

That needs an Apple Developer account. EAS Build makes the iOS build in the cloud, so it works from Windows:
`npm i -g eas-cli`, `eas build -p ios`, then `eas submit -p ios`. Replace `ios.bundleIdentifier` in `app.json` with your own first.

## Code

- `src/game/data.ts`: dishes, shop items, prices and timings (all the balance numbers).
- `src/game/engine.ts`: the simulation (pathfinding, staff jobs, guests, economy). Pure TypeScript, no React Native.
- `src/ui/`: the screen (`Game.tsx`), the board and sprites (`Board.tsx`), bottom sheets, and the game loop hook (`useGame.ts`).
