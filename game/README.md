# Night Bite Diner

An original iPhone game: you run a diner that only opens after midnight, staffed by friendly zombies.
The room is shown in a 3D-style (isometric) view: drag to look around, pinch or use + and − to zoom.

- **Cook:** tap a stove and pick a dish. Longer dishes make more servings and earn more.
- **Your zombies do the rest:** they carry finished food to the serving counter, serve guests and wipe tables.
- **Guests have patience:** feed them before their bar runs out. Happy guests pay coins and raise your star rating; guests who wait too long walk out and lower it.
- **Recruit guests:** a well-fed guest sometimes thinks about joining the night shift. Tap them while “Join?” shows and they become a zombie on your staff. Each zombie walks at its own pace (slow, steady or quick).
- **Espresso:** zombies get sleepy and slow down. Tap ☕ Coffee (or a zombie in the Staff sheet) to wake them.
- **Grow:** buy stoves, counters and tables, add spooky decor (more patient guests, bigger tips), hire more zombies, expand the room from 7 × 7 up to 13 × 13, level up to unlock new dishes.
- **Goals:** one goal at a time under the status bar, each with a coin reward.
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
node scripts/make-sfx.mjs  # regenerates the sound effects in assets/sfx (synthesized, no samples)
```

## Putting it on the App Store

That needs an Apple Developer account. EAS Build makes the iOS build in the cloud, so it works from Windows:
`npm i -g eas-cli`, `eas build -p ios`, then `eas submit -p ios`. Replace `ios.bundleIdentifier` in `app.json` with your own first.

## Code

- `src/game/data.ts`: dishes, shop items, prices and timings (all the balance numbers).
- `src/game/engine.ts`: the simulation (pathfinding, staff jobs, guests, economy). Pure TypeScript, no React Native.
- `src/ui/Board.tsx`: the isometric room (SVG floor, walls, door and furniture), people, pan and zoom, and tap hit-testing.
- `src/ui/Game.tsx`: the screen, goals banner, shop, staff and stove sheets. `useGame.ts` runs the loop and saves; `sound.ts` plays the effects.
