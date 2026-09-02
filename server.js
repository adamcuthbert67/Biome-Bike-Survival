const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync("/var/data") ? "/var/data" : path.join(__dirname, "data"));
const DB_FILE = path.join(DATA_DIR, "accounts.json");
const rooms = new Map();

fs.mkdirSync(DATA_DIR, {recursive:true});
function loadDb(){
  try{
    const parsed=JSON.parse(fs.readFileSync(DB_FILE,"utf8"));
    return parsed && Array.isArray(parsed.users) ? parsed : {users:[]};
  }catch(e){ return {users:[]}; }
}
let db=loadDb();
function saveDb(){
  const tmp=DB_FILE+".tmp";
  fs.writeFileSync(tmp,JSON.stringify(db,null,2));
  fs.renameSync(tmp,DB_FILE);
}
function defaultProfile(){
  return {wallet:0,passXp:0,claimed:[],ownedCharacters:["rider"],ownedBikes:["classic"],ownedTrails:["none"],ownedDances:["auto"],equippedDance:"auto",equippedCharacter:"rider",equippedBike:"classic",equippedTrail:"none",chestsCollected:0,lastFreeSpinDay:""};
}
function uniqueStrings(v,allowedLen=40){
  if(!Array.isArray(v))return [];
  return [...new Set(v.map(x=>String(x).slice(0,allowedLen)).filter(Boolean))].slice(0,100);
}
function sanitizeProfile(v){
  const d=defaultProfile(), p=v&&typeof v==="object"?v:{};
  const ownedCharacters=uniqueStrings(p.ownedCharacters); if(!ownedCharacters.includes("rider"))ownedCharacters.unshift("rider");
  const ownedBikes=uniqueStrings(p.ownedBikes); if(!ownedBikes.includes("classic"))ownedBikes.unshift("classic");
  const ownedTrails=uniqueStrings(p.ownedTrails); if(!ownedTrails.includes("none"))ownedTrails.unshift("none");
  const ownedDances=uniqueStrings(p.ownedDances); if(!ownedDances.includes("auto"))ownedDances.unshift("auto");
  const out={
    wallet:Math.max(0,Math.min(100000000,Math.floor(Number(p.wallet)||0))),
    passXp:Math.max(0,Math.min(59999,Math.floor(Number(p.passXp)||0))),
    chestsCollected:Math.max(0,Math.min(100000000,Math.floor(Number(p.chestsCollected)||0))),
    lastFreeSpinDay:/^\d{4}-\d{2}-\d{2}$/.test(String(p.lastFreeSpinDay||""))?String(p.lastFreeSpinDay):"",
    claimed:[...new Set((Array.isArray(p.claimed)?p.claimed:[]).map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=100))],
    ownedCharacters,ownedBikes,ownedTrails,ownedDances,
    equippedDance:String(p.equippedDance||d.equippedDance).slice(0,40),
    equippedCharacter:String(p.equippedCharacter||d.equippedCharacter).slice(0,40),
    equippedBike:String(p.equippedBike||d.equippedBike).slice(0,40),
    equippedTrail:String(p.equippedTrail||d.equippedTrail).slice(0,40)
  };
  if(!out.ownedCharacters.includes(out.equippedCharacter))out.equippedCharacter="rider";
  if(!out.ownedBikes.includes(out.equippedBike))out.equippedBike="classic";
  if(!out.ownedTrails.includes(out.equippedTrail))out.equippedTrail="none";
  if(!out.ownedDances.includes(out.equippedDance))out.equippedDance="auto";
  return out;
}
function usernameKey(v){return String(v||"").trim().toLowerCase();}
function validUsername(v){return /^[A-Za-z0-9_-]{3,16}$/.test(String(v||""));}
function hashPassword(password,salt){return crypto.scryptSync(String(password),salt,64).toString("hex");}
function tokenHash(token){return crypto.createHash("sha256").update(String(token)).digest("hex");}
function newSession(user){
  const token=crypto.randomBytes(32).toString("hex"), now=Date.now();
  user.sessions=(Array.isArray(user.sessions)?user.sessions:[]).filter(s=>s&&s.expiresAt>now);
  user.sessions.push({hash:tokenHash(token),expiresAt:now+30*24*60*60*1000});
  if(user.sessions.length>8)user.sessions=user.sessions.slice(-8);
  saveDb();
  return token;
}
function accountView(user){
  return {id:user.id,username:user.username,profile:sanitizeProfile(user.profile),bestScore:Math.max(0,Math.floor(Number(user.bestScore)||0))};
}
function authFromToken(token){
  if(!token)return null;
  const h=tokenHash(token), now=Date.now();
  for(const user of db.users){
    user.sessions=Array.isArray(user.sessions)?user.sessions:[];
    if(user.sessions.some(s=>s&&s.hash===h&&s.expiresAt>now))return user;
  }
  return null;
}
function authUser(req){
  const h=String(req.headers.authorization||"");
  const m=h.match(/^Bearer\s+(.+)$/i);
  return authFromToken(m&&m[1]);
}
function json(res,status,obj){
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
  res.end(JSON.stringify(obj));
}
function readJson(req,limit=50000){
  return new Promise((resolve,reject)=>{
    let body="";
    req.on("data",chunk=>{body+=chunk;if(body.length>limit){reject(new Error("Request too large"));req.destroy();}});
    req.on("end",()=>{try{resolve(body?JSON.parse(body):{});}catch(e){reject(new Error("Invalid JSON"));}});
    req.on("error",reject);
  });
}
function safeName(v){return String(v||"Guest").trim().slice(0,18).replace(/[<>]/g,"")||"Guest";}
function safeClientKey(v){return String(v||"").replace(/[^A-Za-z0-9_-]/g,"").slice(0,80);}
const MAX_ROOM_PLAYERS=3;
const EMPTY_ROOM_GRACE_MS=60000;
function roomCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for(let tries=0;tries<1000;tries++){let s="";for(let i=0;i<4;i++)s+=chars[Math.floor(Math.random()*chars.length)];if(!rooms.has(s))return s;}
  return crypto.randomBytes(3).toString("hex").slice(0,4).toUpperCase();
}
function send(ws,obj){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj));}
function publicPlayer(p){return {id:p.id,name:p.name,isHost:p.isHost,ready:!!p.ready,x:p.x,y:p.y,w:p.w,h:p.h,score:p.score,coins:p.coins,biome:p.biome,equippedCharacter:p.equippedCharacter,equippedBike:p.equippedBike,equippedTrail:p.equippedTrail,alive:p.alive!==false,respawnAt:p.respawnAt||0,deathFlashUntil:p.deathFlashUntil||0};}
function broadcast(room,obj,except=null){for(const p of room.players.values())if(p.ws&&p.ws!==except)send(p.ws,obj);}
function broadcastRoomState(room){
  broadcast(room,{type:"room_state",roomCode:room.code,hostId:room.hostId,started:room.started,starting:!!room.starting,difficulty:room.difficulty||"normal",startWorld:Number.isInteger(room.startWorld)?room.startWorld:-1,roundId:room.roundId||0,startAt:room.startAt||0,players:[...room.players.values()].map(publicPlayer)});
}
function scheduleEmptyRoomCleanup(room){
  if(room.cleanupTimer)clearTimeout(room.cleanupTimer);
  if(room.players.size!==0)return;
  room.cleanupTimer=setTimeout(()=>{const current=rooms.get(room.code);if(current&&current.players.size===0)rooms.delete(room.code);},EMPTY_ROOM_GRACE_MS);
}
function detachPlayer(player,{keepEmptyRoom=true}={}){
  if(!player)return;
  const oldCode=player.roomCode;
  if(player.respawnTimer){clearTimeout(player.respawnTimer);player.respawnTimer=null;}
  player.roomCode=null;player.isHost=false;player.ready=false;player.alive=true;player.respawnAt=0;player.deathFlashUntil=0;
  if(!oldCode)return;
  const room=rooms.get(oldCode);if(!room)return;
  room.players.delete(player.id);
  broadcast(room,{type:"player_left",playerId:player.id});
  if(room.players.size===0){
    room.hostId=null;room.started=false;
    if(keepEmptyRoom)scheduleEmptyRoomCleanup(room);else rooms.delete(room.code);
    return;
  }
  if(room.hostId===player.id||!room.players.has(room.hostId)){
    const next=room.players.values().next().value;room.hostId=next.id;next.isHost=true;
  }
  broadcastRoomState(room);
}
function addPlayerToRoom(room,player,name,clientKey){
  if(room.cleanupTimer){clearTimeout(room.cleanupTimer);room.cleanupTimer=null;}
  // Replace a stale connection from the same browser session instead of consuming another slot.
  const same=[...room.players.values()].find(p=>clientKey&&p.clientKey===clientKey&&p.id!==player.id);
  if(same){try{send(same.ws,{type:"replaced_connection"});same.ws&&same.ws.close();}catch(e){}room.players.delete(same.id);}
  player.name=safeName(name);player.clientKey=safeClientKey(clientKey);player.roomCode=room.code;player.ready=false;player.alive=true;player.respawnAt=0;player.deathFlashUntil=0;
  room.players.set(player.id,player);
  if(!room.hostId||!room.players.has(room.hostId)){room.hostId=player.id;}
  for(const p of room.players.values())p.isHost=p.id===room.hostId;
}


const server=http.createServer(async(req,res)=>{
  const pathname=req.url.split("?")[0];
  try{
    if(pathname==="/api/health"&&req.method==="GET"){
      return json(res,200,{ok:true,accounts:true,multiplayer:true,version:"v32-item-shop-dances"});
    }
    if(pathname==="/api/register"&&req.method==="POST"){
      const b=await readJson(req), username=String(b.username||"").trim(), password=String(b.password||"");
      if(!validUsername(username))return json(res,400,{error:"Username must be 3-16 characters using letters, numbers, _ or -."});
      if(password.length<6||password.length>100)return json(res,400,{error:"Password must be 6-100 characters."});
      if(db.users.some(u=>u.usernameKey===usernameKey(username)))return json(res,409,{error:"That username is already taken."});
      const salt=crypto.randomBytes(16).toString("hex");
      const user={id:crypto.randomUUID(),username,usernameKey:usernameKey(username),salt,passwordHash:hashPassword(password,salt),profile:defaultProfile(),bestScore:0,createdAt:Date.now(),updatedAt:Date.now(),sessions:[]};
      db.users.push(user); saveDb();
      const token=newSession(user);
      return json(res,201,{token,account:accountView(user)});
    }
    if(pathname==="/api/login"&&req.method==="POST"){
      const b=await readJson(req), key=usernameKey(b.username), password=String(b.password||"");
      const user=db.users.find(u=>u.usernameKey===key);
      if(!user)return json(res,401,{error:"Wrong username or password."});
      const got=Buffer.from(hashPassword(password,user.salt),"hex"), expected=Buffer.from(user.passwordHash,"hex");
      if(got.length!==expected.length||!crypto.timingSafeEqual(got,expected))return json(res,401,{error:"Wrong username or password."});
      const token=newSession(user); return json(res,200,{token,account:accountView(user)});
    }
    if(pathname==="/api/me"&&req.method==="GET"){
      const user=authUser(req); if(!user)return json(res,401,{error:"Please log in again."});
      return json(res,200,{account:accountView(user)});
    }
    if(pathname==="/api/logout"&&req.method==="POST"){
      const h=String(req.headers.authorization||"").match(/^Bearer\s+(.+)$/i), user=authUser(req);
      if(user&&h){const th=tokenHash(h[1]);user.sessions=(user.sessions||[]).filter(s=>s.hash!==th);saveDb();}
      return json(res,200,{ok:true});
    }
    if(pathname==="/api/progress"&&req.method==="POST"){
      const user=authUser(req); if(!user)return json(res,401,{error:"Please log in again."});
      const b=await readJson(req);
      user.profile=sanitizeProfile(b.profile);
      const submitted=Math.max(0,Math.min(100000000,Math.floor(Number(b.bestScore)||0)));
      user.bestScore=Math.max(Math.floor(Number(user.bestScore)||0),submitted);
      user.updatedAt=Date.now(); saveDb();
      return json(res,200,{account:accountView(user)});
    }
    if(pathname==="/api/leaderboard"&&req.method==="GET"){
      const played=db.users.filter(u=>Math.max(0,Math.floor(Number(u.bestScore)||0))>0);
      const leaders=played.map(u=>({username:u.username,bestScore:Math.max(0,Math.floor(Number(u.bestScore)||0))}))
        .sort((a,b)=>b.bestScore-a.bestScore||a.username.localeCompare(b.username)).slice(0,100)
        .map((x,i)=>({rank:i+1,...x}));
      return json(res,200,{leaders,totalPlayers:played.length});
    }
  }catch(e){console.error(e);return json(res,500,{error:"Server error."});}

  let url=pathname; if(url==="/")url="/index.html";
  const file=path.normalize(path.join(PUBLIC,url));
  if(!file.startsWith(PUBLIC)){res.writeHead(403);res.end("Forbidden");return;}
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404);res.end("Not found");return;}
    const ext=path.extname(file).toLowerCase();
    const types={".html":"text/html; charset=utf-8",".js":"application/javascript",".css":"text/css",".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml"};
    res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream","Cache-Control":"no-store"});res.end(data);
  });
});

const wss=new WebSocket.Server({server});

function endRound(room, reason="ROUND_ENDED"){
  if(!room)return;
  room.started=false;room.startAt=0;
  for(const p of room.players.values()){p.ready=false;
    if(p.respawnTimer){clearTimeout(p.respawnTimer);p.respawnTimer=null;}
    p.alive=true;p.respawnAt=0;p.deathFlashUntil=0;
  }
  broadcast(room,{type:"round_ended",reason});
  broadcastRoomState(room);
}

wss.on("connection",ws=>{
  ws.isAlive=true;
  ws.on("pong",()=>{ws.isAlive=true;});
  const player={id:crypto.randomUUID(),ws,name:"Guest",roomCode:null,isHost:false,ready:false,x:null,y:null,w:44,h:52,score:0,coins:0,biome:0,equippedCharacter:"rider",equippedBike:"classic",equippedTrail:"none",alive:true,respawnAt:0,deathFlashUntil:0,respawnTimer:null};
  send(ws,{type:"hello",playerId:player.id,serverVersion:"multiplayer-ready-v8",maxPlayers:MAX_ROOM_PLAYERS});

  ws.on("message",raw=>{
    let m;try{m=JSON.parse(raw.toString());}catch{return;}
    if(!m||typeof m.type!=="string")return;
    if(m.type==="client_ping"){send(ws,{type:"server_pong",t:Date.now()});return;}

    if(m.type==="create_room"){
      detachPlayer(player,{keepEmptyRoom:false});
      const code=roomCode();
      const room={code,hostId:player.id,started:false,starting:false,difficulty:"normal",startWorld:-1,roundId:0,startAt:0,players:new Map(),cleanupTimer:null};
      rooms.set(code,room);
      player.name=safeName(m.name);player.clientKey=safeClientKey(m.clientKey);player.roomCode=code;player.isHost=true;player.ready=false;player.alive=true;
      room.players.set(player.id,player);
      send(ws,{type:"room_joined",roomCode:code,playerId:player.id,isHost:true,started:false,difficulty:room.difficulty,startWorld:room.startWorld,roundId:0,players:[...room.players.values()].map(publicPlayer)});
      broadcastRoomState(room);
      return;
    }

    if(m.type==="join_room"){
      const code=String(m.roomCode||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,4);
      if(code.length!==4){send(ws,{type:"error",code:"BAD_CODE",message:"Enter a valid 4-character room code."});return;}
      const room=rooms.get(code);
      if(!room){send(ws,{type:"error",code:"ROOM_NOT_FOUND",message:"Room not found. Ask the host for the current 4-character code."});return;}
      // A player can rejoin an in-progress room. This is important on hosted services where
      // a browser/WebSocket can briefly reconnect even though the page itself stayed open.
      if(room.players.size>=MAX_ROOM_PLAYERS){send(ws,{type:"error",code:"ROOM_FULL",message:"Room is full (3 players max)."});return;}

      // Only leave an existing room after the target room has been validated.
      if(player.roomCode&&player.roomCode!==code)detachPlayer(player,{keepEmptyRoom:true});
      if(room.players.has(player.id)){
        send(ws,{type:"room_joined",roomCode:code,playerId:player.id,isHost:player.id===room.hostId,started:room.started,difficulty:room.difficulty,startWorld:room.startWorld,roundId:room.roundId,players:[...room.players.values()].map(publicPlayer)});
        if(room.started)send(ws,{type:"game_start",difficulty:room.difficulty,startWorld:room.startWorld,roundId:room.roundId,playerCount:room.players.size,startAt:Date.now()+350,rejoin:true});
        return;
      }
      player.name=safeName(m.name);player.clientKey=safeClientKey(m.clientKey);player.roomCode=code;player.isHost=false;player.ready=false;player.alive=true;player.respawnAt=0;player.deathFlashUntil=0;
      room.players.set(player.id,player);
      if(!room.hostId||!room.players.has(room.hostId))room.hostId=player.id;
      for(const p of room.players.values())p.isHost=p.id===room.hostId;
      send(ws,{type:"room_joined",roomCode:code,playerId:player.id,isHost:player.id===room.hostId,started:room.started,difficulty:room.difficulty,startWorld:room.startWorld,roundId:room.roundId,players:[...room.players.values()].map(publicPlayer)});
      broadcastRoomState(room);
      if(room.started)send(ws,{type:"game_start",difficulty:room.difficulty,startWorld:room.startWorld,roundId:room.roundId,playerCount:room.players.size,startAt:Date.now()+350,rejoin:true});
      return;
    }

    if(m.type==="leave_room"){
      detachPlayer(player,{keepEmptyRoom:false});
      return;
    }

    const room=player.roomCode?rooms.get(player.roomCode):null;
    if(!room||!room.players.has(player.id)){
      send(ws,{type:"error",code:"NOT_IN_ROOM",message:"You are not in a multiplayer room. Create or join one again."});
      return;
    }

    if(m.type==="set_ready"){
      if(room.started){send(ws,{type:"error",code:"ROUND_RUNNING",message:"The round is already running."});return;}
      player.ready=!!m.ready;
      broadcastRoomState(room);
      return;
    }

    if(m.type==="start_game"){
      const count=room.players.size;
      if(player.id!==room.hostId){send(ws,{type:"error",code:"HOST_ONLY",message:"Only the room host can start the multiplayer run."});return;}
      if(count<2||count>3){send(ws,{type:"error",code:"NEED_PLAYERS",message:"Multiplayer needs 2 or 3 connected players before the host can start."});broadcastRoomState(room);return;}
      if(room.started||room.starting){send(ws,{type:"error",code:"ALREADY_STARTING",message:"The multiplayer round is already starting or running."});return;}
      const allReady=[...room.players.values()].every(p=>p.ready===true);
      if(!allReady){send(ws,{type:"error",code:"NOT_READY",message:"Every player must press READY before the host can start."});broadcastRoomState(room);return;}
      room.starting=false; room.started=true;
      room.difficulty=String(m.difficulty||"normal");
      room.startWorld=Number.isInteger(m.startWorld)?m.startWorld:-1;
      room.roundId=(room.roundId||0)+1;
      room.startAt=Date.now()+250;
      for(const p of room.players.values()){
        if(p.respawnTimer){clearTimeout(p.respawnTimer);p.respawnTimer=null;}
        p.alive=true;p.respawnAt=0;p.deathFlashUntil=0;
      }
      // Immediate authoritative launch. room_state also carries started/roundId/startAt,
      // so clients have a built-in fallback even if this one broadcast is missed.
      broadcast(room,{type:"game_start",roundId:room.roundId,playerCount:count,difficulty:room.difficulty,startWorld:room.startWorld,startAt:room.startAt});
      broadcastRoomState(room);
      return;
    }

    if(m.type==="player_eliminated"){
      if(!room.started||player.alive===false)return;
      const now=Date.now();player.alive=false;player.respawnAt=now+10000;player.deathFlashUntil=now+1000;
      broadcast(room,{type:"player_eliminated",playerId:player.id,name:player.name,respawnAt:player.respawnAt,deathFlashUntil:player.deathFlashUntil});
      broadcastRoomState(room);
      const everyoneOut=[...room.players.values()].every(p=>p.alive===false);
      if(everyoneOut){
        room.started=false;room.startAt=0;
        for(const p of room.players.values()){p.ready=false;
          if(p.respawnTimer){clearTimeout(p.respawnTimer);p.respawnTimer=null;}
          p.respawnAt=0;
        }
        broadcast(room,{type:"all_eliminated"});
        broadcastRoomState(room);
        return;
      }
      player.respawnTimer=setTimeout(()=>{
        const liveRoom=player.roomCode?rooms.get(player.roomCode):null;
        if(!liveRoom||!liveRoom.started||!liveRoom.players.has(player.id)||player.alive!==false)return;
        player.alive=true;player.respawnAt=0;player.deathFlashUntil=0;player.respawnTimer=null;
        send(player.ws,{type:"player_respawn",invincibleMs:2000});
        broadcast(liveRoom,{type:"player_respawned",playerId:player.id},player.ws);
        broadcastRoomState(liveRoom);
      },10000);
      return;
    }

    if(m.type==="player_state"){
      if(!room.started||player.alive===false)return;
      const num=(v,lo,hi,d)=>Number.isFinite(Number(v))?Math.max(lo,Math.min(hi,Number(v))):d;
      player.x=num(m.x,-100,1200,player.x);player.y=num(m.y,-100,520,player.y);player.w=num(m.w,20,90,44);player.h=num(m.h,20,100,52);
      player.score=num(m.score,0,1e9,0);player.coins=num(m.coins,0,1e9,0);player.biome=num(m.biome,0,100,0);
      player.equippedCharacter=String(m.equippedCharacter||"rider").slice(0,30);player.equippedBike=String(m.equippedBike||"classic").slice(0,30);player.equippedTrail=String(m.equippedTrail||"none").slice(0,30);player.name=safeName(m.name||player.name);
      broadcast(room,{type:"player_state",player:publicPlayer(player)},ws);
      return;
    }
  });

  ws.on("close",()=>{
    const code=player.roomCode;
    const room=code?rooms.get(code):null;
    detachPlayer(player,{keepEmptyRoom:true});
    if(room&&room.started&&room.players.size===0){
      // Preserve the room code briefly so players can reconnect after a transient drop.
      room.started=false;
    }
    // Do not kill an active round just because one of 2-3 sockets briefly disconnects.
    // Remaining players may continue and the missing player can rejoin the same code.

  });
});

const heartbeat=setInterval(()=>{
  for(const ws of wss.clients){
    if(ws.isAlive===false){try{ws.terminate();}catch(e){}continue;}
    ws.isAlive=false;try{ws.ping();}catch(e){}
  }
},25000);
wss.on("close",()=>clearInterval(heartbeat));

server.listen(PORT,"0.0.0.0",()=>console.log(`Biome Bike Online running on port ${PORT}; account data: ${DB_FILE}`));
