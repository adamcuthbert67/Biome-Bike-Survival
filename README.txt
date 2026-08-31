BIOME BIKE ONLINE — SEPARATE SINGLE PLAYER + MULTIPLAYER

HOME PAGE
- SINGLE PLAYER launches the normal game.
- ONLINE MULTIPLAYER opens a separate multiplayer lobby.

MULTIPLAYER
- CREATE NEW ROOM generates a fresh 4-character code every time.
- JOIN ROOM uses the 4-character code from the host.
- Up to 8 players.
- Host starts the online run.
- If the host leaves, host transfers to another player.
- NEW ROOM CODE lets the host discard the current room and generate another fresh code.

RUN LOCALLY
1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run: npm install
4. Run: npm start
5. Open http://localhost:3000

REAL INTERNET PLAY
Deploy this entire folder to a Node.js hosting provider. All players must visit the same deployed site.
The site automatically switches to secure WebSockets (wss://) when hosted over HTTPS.

MULTIPLAYER MAP SIZE
- Single Player remains 700 x 430 exactly as before.
- Online Multiplayer uses 1000 x 430 for extra horizontal riding room.
- Every multiplayer biome uses the same 1000 x 430 size.
- Existing biome artwork is preserved and extended to the wider canvas.
- Extra biome-matched scenery appears along the wider side areas.
