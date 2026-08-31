
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const rooms = new Map();

function safeName(v){
  return String(v || "Guest").trim().slice(0,18).replace(/[<>]/g,"") || "Guest";
}
function roomCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for(let tries=0;tries<1000;tries++){
    let s="";
    for(let i=0;i<4;i++)s+=chars[Math.floor(Math.random()*chars.length)];
    if(!rooms.has(s))return s;
  }
  return crypto.randomBytes(3).toString("hex").slice(0,4).toUpperCase();
}
function send(ws,obj){
  if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj));
}
function publicPlayer(p){
  return {
    id:p.id,name:p.name,isHost:p.isHost,
    x:p.x,y:p.y,w:p.w,h:p.h,score:p.score,coins:p.coins,biome:p.biome,
    equippedCharacter:p.equippedCharacter,equippedBike:p.equippedBike
  };
}
function broadcast(room,obj,except=null){
  for(const p of room.players.values()){
    if(p.ws!==except)send(p.ws,obj);
  }
}
function broadcastRoomState(room){
  const players=[...room.players.values()].map(publicPlayer);
  broadcast(room,{type:"room_state",roomCode:room.code,hostId:room.hostId,started:room.started,players});
}
function detachPlayer(player){
  if(!player || !player.roomCode)return;
  const room=rooms.get(player.roomCode);
  if(!room)return;
  room.players.delete(player.id);
  broadcast(room,{type:"player_left",playerId:player.id});
  if(room.players.size===0){
    rooms.delete(room.code);
    return;
  }
  if(room.hostId===player.id){
    const next=room.players.values().next().value;
    room.hostId=next.id;
    next.isHost=true;
  }
  broadcastRoomState(room);
}

const server=http.createServer((req,res)=>{
  let url=req.url.split("?")[0];
  if(url==="/")url="/index.html";
  const file=path.normalize(path.join(PUBLIC,url));
  if(!file.startsWith(PUBLIC)){res.writeHead(403);res.end("Forbidden");return;}
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404);res.end("Not found");return;}
    const ext=path.extname(file).toLowerCase();
    const types={".html":"text/html; charset=utf-8",".js":"application/javascript",".css":"text/css",".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml"};
    res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream","Cache-Control":"no-store"});
    res.end(data);
  });
});

const wss=new WebSocket.Server({server});
wss.on("connection",ws=>{
  const player={
    id:crypto.randomUUID(),ws,name:"Guest",roomCode:null,isHost:false,
    x:null,y:null,w:44,h:52,score:0,coins:0,biome:0,equippedCharacter:"rider",equippedBike:"classic"
  };

  ws.on("message",raw=>{
    let m;
    try{m=JSON.parse(raw.toString());}catch{return;}
    if(!m || typeof m.type!=="string")return;

    if(m.type==="create_room"){
      detachPlayer(player);
      const code=roomCode();
      player.name=safeName(m.name);
      player.roomCode=code;player.isHost=true;
      const room={code,hostId:player.id,started:false,players:new Map([[player.id,player]])};
      rooms.set(code,room);
      send(ws,{type:"room_joined",roomCode:code,playerId:player.id,isHost:true,started:false,players:[publicPlayer(player)]});
      return;
    }

    if(m.type==="join_room"){
      detachPlayer(player);
      const code=String(m.roomCode||"").toUpperCase().trim();
      const room=rooms.get(code);
      if(!room){send(ws,{type:"error",message:"Room not found."});return;}
      if(room.started){send(ws,{type:"error",message:"That room is already in a run."});return;}
      if(room.players.size>=8){send(ws,{type:"error",message:"Room is full (8 players max)."});return;}
      player.name=safeName(m.name);player.roomCode=code;player.isHost=false;
      room.players.set(player.id,player);
      send(ws,{type:"room_joined",roomCode:code,playerId:player.id,isHost:false,started:false,players:[...room.players.values()].map(publicPlayer)});
      broadcastRoomState(room);
      return;
    }

    if(m.type==="leave_room"){detachPlayer(player);player.roomCode=null;player.isHost=false;return;}

    const room=rooms.get(player.roomCode);
    if(!room)return;

    if(m.type==="start_game"){
      if(room.hostId!==player.id)return;
      room.started=true;
      room.difficulty=String(m.difficulty||"normal");
      room.startWorld=Number.isInteger(m.startWorld)?m.startWorld:-1;
      broadcast(room,{type:"game_start",difficulty:room.difficulty,startWorld:room.startWorld});
      return;
    }

    if(m.type==="player_state"){
      const num=(v,lo,hi,d)=>Number.isFinite(Number(v))?Math.max(lo,Math.min(hi,Number(v))):d;
      player.x=num(m.x,-100,1200,player.x);
      player.y=num(m.y,-100,520,player.y);
      player.w=num(m.w,20,90,44);player.h=num(m.h,20,100,52);
      player.score=num(m.score,0,1e9,0);player.coins=num(m.coins,0,1e9,0);player.biome=num(m.biome,0,100,0);
      player.equippedCharacter=String(m.equippedCharacter||"rider").slice(0,30);
      player.equippedBike=String(m.equippedBike||"classic").slice(0,30);
      player.name=safeName(m.name||player.name);
      broadcast(room,{type:"player_state",player:publicPlayer(player)},ws);
      return;
    }
  });

  ws.on("close",()=>detachPlayer(player));
});

server.listen(PORT,()=>console.log(`Biome Bike Online running on http://localhost:${PORT}`));
