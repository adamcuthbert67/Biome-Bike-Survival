const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
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
  return {wallet:0,passXp:0,claimed:[],ownedCharacters:["rider"],ownedBikes:["classic"],ownedTrails:["none"],equippedCharacter:"rider",equippedBike:"classic",equippedTrail:"none",chestsCollected:0};
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
  const out={
    wallet:Math.max(0,Math.min(100000000,Math.floor(Number(p.wallet)||0))),
    passXp:Math.max(0,Math.min(12499,Math.floor(Number(p.passXp)||0))),
    chestsCollected:Math.max(0,Math.min(100000000,Math.floor(Number(p.chestsCollected)||0))),
    claimed:[...new Set((Array.isArray(p.claimed)?p.claimed:[]).map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=50))],
    ownedCharacters,ownedBikes,ownedTrails,
    equippedCharacter:String(p.equippedCharacter||d.equippedCharacter).slice(0,40),
    equippedBike:String(p.equippedBike||d.equippedBike).slice(0,40),
    equippedTrail:String(p.equippedTrail||d.equippedTrail).slice(0,40)
  };
  if(!out.ownedCharacters.includes(out.equippedCharacter))out.equippedCharacter="rider";
  if(!out.ownedBikes.includes(out.equippedBike))out.equippedBike="classic";
  if(!out.ownedTrails.includes(out.equippedTrail))out.equippedTrail="none";
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
function roomCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for(let tries=0;tries<1000;tries++){let s="";for(let i=0;i<4;i++)s+=chars[Math.floor(Math.random()*chars.length)];if(!rooms.has(s))return s;}
  return crypto.randomBytes(3).toString("hex").slice(0,4).toUpperCase();
}
function send(ws,obj){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj));}
function publicPlayer(p){return {id:p.id,name:p.name,isHost:p.isHost,x:p.x,y:p.y,w:p.w,h:p.h,score:p.score,coins:p.coins,biome:p.biome,equippedCharacter:p.equippedCharacter,equippedBike:p.equippedBike};}
function broadcast(room,obj,except=null){for(const p of room.players.values())if(p.ws!==except)send(p.ws,obj);}
function broadcastRoomState(room){broadcast(room,{type:"room_state",roomCode:room.code,hostId:room.hostId,started:room.started,players:[...room.players.values()].map(publicPlayer)});}
function detachPlayer(player){
  if(!player||!player.roomCode)return;
  const room=rooms.get(player.roomCode); if(!room)return;
  room.players.delete(player.id); broadcast(room,{type:"player_left",playerId:player.id});
  if(room.players.size===0){rooms.delete(room.code);return;}
  if(room.hostId===player.id){const next=room.players.values().next().value;room.hostId=next.id;next.isHost=true;}
  broadcastRoomState(room);
}

const server=http.createServer(async(req,res)=>{
  const pathname=req.url.split("?")[0];
  try{
    if(pathname==="/api/health"&&req.method==="GET"){
      return json(res,200,{ok:true,accounts:true,multiplayer:true,version:"render-ready"});
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
wss.on("connection",ws=>{
  const player={id:crypto.randomUUID(),ws,name:"Guest",roomCode:null,isHost:false,x:null,y:null,w:44,h:52,score:0,coins:0,biome:0,equippedCharacter:"rider",equippedBike:"classic"};
  ws.on("message",raw=>{
    let m;try{m=JSON.parse(raw.toString());}catch{return;}if(!m||typeof m.type!=="string")return;
    if(m.type==="create_room"){
      detachPlayer(player);const code=roomCode();player.name=safeName(m.name);player.roomCode=code;player.isHost=true;
      const room={code,hostId:player.id,started:false,players:new Map([[player.id,player]])};rooms.set(code,room);
      send(ws,{type:"room_joined",roomCode:code,playerId:player.id,isHost:true,started:false,players:[publicPlayer(player)]});return;
    }
    if(m.type==="join_room"){
      detachPlayer(player);const code=String(m.roomCode||"").toUpperCase().trim();const room=rooms.get(code);
      if(!room){send(ws,{type:"error",message:"Room not found."});return;}if(room.started){send(ws,{type:"error",message:"That room is already in a run."});return;}if(room.players.size>=8){send(ws,{type:"error",message:"Room is full (8 players max)."});return;}
      player.name=safeName(m.name);player.roomCode=code;player.isHost=false;room.players.set(player.id,player);
      send(ws,{type:"room_joined",roomCode:code,playerId:player.id,isHost:false,started:false,players:[...room.players.values()].map(publicPlayer)});broadcastRoomState(room);return;
    }
    if(m.type==="leave_room"){detachPlayer(player);player.roomCode=null;player.isHost=false;return;}
    const room=rooms.get(player.roomCode);if(!room)return;
    if(m.type==="start_game"){if(room.hostId!==player.id)return;room.started=true;room.difficulty=String(m.difficulty||"normal");room.startWorld=Number.isInteger(m.startWorld)?m.startWorld:-1;broadcast(room,{type:"game_start",difficulty:room.difficulty,startWorld:room.startWorld});return;}
    if(m.type==="player_state"){
      const num=(v,lo,hi,d)=>Number.isFinite(Number(v))?Math.max(lo,Math.min(hi,Number(v))):d;
      player.x=num(m.x,-100,1200,player.x);player.y=num(m.y,-100,520,player.y);player.w=num(m.w,20,90,44);player.h=num(m.h,20,100,52);player.score=num(m.score,0,1e9,0);player.coins=num(m.coins,0,1e9,0);player.biome=num(m.biome,0,100,0);
      player.equippedCharacter=String(m.equippedCharacter||"rider").slice(0,30);player.equippedBike=String(m.equippedBike||"classic").slice(0,30);player.name=safeName(m.name||player.name);broadcast(room,{type:"player_state",player:publicPlayer(player)},ws);return;
    }
  });
  ws.on("close",()=>detachPlayer(player));
});

server.listen(PORT,"0.0.0.0",()=>console.log(`Biome Bike Online running on port ${PORT}; account data: ${DB_FILE}`));
