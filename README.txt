BIOME BIKE SURVIVAL — ACCOUNT + LEADERBOARD BUILD

Run locally:
1. Install Node.js 18+
2. npm install
3. npm start
4. Open http://localhost:3000

Render commands:
Build Command: npm install
Start Command: npm start
Root Directory: leave blank

NEW IN THIS BUILD
- Unique player accounts (username + password)
- Passwords are salted + hashed with Node scrypt; plain passwords are never stored
- Login sessions persist for 30 days in the account database
- Wallet, Battle Pass XP, claimed rewards, owned/equipped cosmetics and best score sync to the logged-in account
- Global all-time highest-score leaderboard for registered players who have completed a scored run
- Battle Pass is substantially slower: 250 XP per level and run XP is roughly score / 10 (minimum 5)
- Existing local profile is carried into a newly-created account
- Local save remains as a fallback on the same browser

IMPORTANT — PERMANENT SERVER STORAGE ON RENDER
Account/progress data is stored in data/accounts.json by default.
That is durable on your own computer/server, but Render's normal filesystem may be replaced on a redeploy/restart.
For truly permanent live accounts on Render, attach persistent storage and set environment variable:
DATA_DIR=/var/data
(or set DATA_DIR to the mount path you choose).
Without persistent server storage, the game still saves locally in each browser, but the global account database/leaderboard can be lost if Render replaces the instance.


MULTIPLAYER ROUND UPDATE
- Any room member can press START ONLINE RUN; everyone starts together.
- Supports solo and multi-player rooms, including 2-3 players.
- Collision eliminates a player for 10 seconds while at least one other player is alive.
- Eliminated rider flashes red for 1 second and is marked OUT in the player list.
- Respawning grants 2 seconds of invincibility.
- If every connected player is eliminated before a respawn, the round ends immediately and the lobby remains available for a new run.


MULTIPLAYER PERFECT V3: 2-3 player rooms, synchronized server-timed starts, reconnect/rejoin, 10s elimination, 1s red death flash, 2s respawn invincibility.

DESIGN UPDATE V9 (2026-09-01)
- Multiplayer/gameplay logic preserved from Multiplayer Ready V8.
- Locker character cards now use illustrated character portraits instead of emoji-only previews.
- Character cosmetics received more detailed visual styling, including Arcane Rider/Wizard.
- Added Daily Spin to home menu: one free spin per local calendar day; extra spins cost 250 coins.
- Daily Spin contains 15 distinct rewards (coins, exclusive skins and bikes), including Cosmic Sovereign at exactly 1% selection weight.
- Daily Spin free-use state syncs with signed-in profiles.
- +50 pickup text now cycles colour continuously for the enchanted/rainbow-style effect.


V16: homepage menu scrolling restored and homepage/landing colours made more vibrant. Gameplay and multiplayer logic unchanged.


V18 COSMETIC RENDER FIX: equipped character and ride now render as exclusive full replacements; remote multiplayer riders also use synced cosmetics.


V24: Replaced six Battle Pass characters with unique map-themed skins (Candyland, Pirate Cove, Toy World, Crystal Cavern, Steampunk Empire, Ancient Egypt). Sunfall Emperor remains Mythic. Internal IDs preserved for save compatibility.
