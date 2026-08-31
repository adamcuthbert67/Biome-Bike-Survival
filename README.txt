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
