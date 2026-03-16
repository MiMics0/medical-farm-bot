import express from "express";
import {
Client,
GatewayIntentBits,
ActionRowBuilder,
ButtonBuilder,
ButtonStyle,
EmbedBuilder,
SlashCommandBuilder,
REST,
Routes
} from "discord.js";

import cron from "node-cron";
import moment from "moment-timezone";
import fs from "fs-extra";

/* ================= CONFIG ================= */

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const ANNOUNCE_CHANNEL_ID = "1472992266464526549";
const FARM_CHANNEL_ID = "1474396476514893898";
const REQUIRED_ROLE_ID = "1402559873257832508";

const DATA_FILE = "./data.json";

/* ================= EXPRESS ================= */

const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
res.send("Medical Farm Bot Running");
});

app.listen(PORT, () => {
console.log("Web server running on port " + PORT);
});

setInterval(()=>{
console.log("keep alive");
},300000);

/* ================= DATA ================= */

function loadData(){

if(!fs.existsSync(DATA_FILE)){
fs.writeJsonSync(DATA_FILE,{});
}

const data = fs.readJsonSync(DATA_FILE);

data.availability ??= {};
data.statusClosed ??= false;
data.statusMessageId ??= null;
data.statusDate ??= null;
data.currentPair ??= null;
data.farmStatus ??= {};
data.fines ??= {};
data.farmCount ??= {};
data.weeklyFarm ??= {};

return data;

}

function saveData(data){
fs.writeJsonSync(DATA_FILE,data,{spaces:2});
}

/* ================= CLIENT ================= */

const client = new Client({
intents:[
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMembers,
GatewayIntentBits.GuildMessages
]
});

/* ================= COMMANDS ================= */

const commands=[

new SlashCommandBuilder()
.setName("leaderboard")
.setDescription("ดูอันดับคนฟาร์มมากที่สุด"),

new SlashCommandBuilder()
.setName("fine")
.setDescription("ดูค่าปรับสะสม")

].map(c=>c.toJSON());

const rest = new REST({version:"10"}).setToken(TOKEN);

/* ================= TIME ================= */

function todayKey(){
return moment().tz("Asia/Bangkok").format("YYYY-MM-DD");
}

function displayDate(){
return moment().tz("Asia/Bangkok").add(1,"day").format("DD/MM/YYYY");
}

/* ================= RANDOM ================= */

function weightedPick(users,weights){

const total = users.reduce((s,id)=>s+(weights[id]||1),0);

let r = Math.random()*total;

for(const id of users){
r -= (weights[id]||1);
if(r<=0) return id;
}

return users[0];

}

/* ================= STATUS POST ================= */

async function sendStatusPost(){

const guild = await client.guilds.fetch(GUILD_ID);
const channel = await guild.channels.fetch(ANNOUNCE_CHANNEL_ID);

if(!channel) return;

const data = loadData();

const embed = new EmbedBuilder()
.setColor("#2B8AF7")
.setTitle(`📋 ลงสถานะเวรฟาร์มประจำวันที่ ${displayDate()}`)
.setDescription("กดเลือกสถานะของคุณ\n⏳ ปิดรับ 23:59")
.addFields(
{name:"🟢 ว่าง (0)",value:"-",inline:true},
{name:"🔴 ไม่ว่าง (0)",value:"-",inline:true}
);

const row = new ActionRowBuilder().addComponents(

new ButtonBuilder()
.setCustomId("available")
.setLabel("ว่าง")
.setStyle(ButtonStyle.Success),

new ButtonBuilder()
.setCustomId("unavailable")
.setLabel("ไม่ว่าง")
.setStyle(ButtonStyle.Danger)

);

const msg = await channel.send({
content:`<@&${REQUIRED_ROLE_ID}>`,
embeds:[embed],
components:[row]
});

data.statusMessageId = msg.id;
data.statusDate = todayKey();
data.availability = {};
data.statusClosed = false;
data.currentPair = null;
data.farmStatus = {};

saveData(data);

}

/* ================= UPDATE EMBED ================= */

async function updateStatus(){

const data = loadData();

if(!data.statusMessageId) return;

try{

const guild = await client.guilds.fetch(GUILD_ID);
const channel = await guild.channels.fetch(ANNOUNCE_CHANNEL_ID);
const msg = await channel.messages.fetch(data.statusMessageId);

const free=[];
const busy=[];

for(const [id,v] of Object.entries(data.availability)){

if(v) free.push(`<@${id}>`);
else busy.push(`<@${id}>`);

}

const embed = new EmbedBuilder()
.setColor(data.statusClosed?"#6c757d":"#2B8AF7")
.setTitle(`📋 ลงสถานะเวรฟาร์มประจำวันที่ ${displayDate()}`)
.setDescription(data.statusClosed?"🔒 ปิดรับแล้ว":"กดเลือกสถานะของคุณ\n⏳ ปิดรับ 23:59")
.addFields(
{
name:`🟢 ว่าง (${free.length})`,
value:free.join("\n")||"-",
inline:true
},
{
name:`🔴 ไม่ว่าง (${busy.length})`,
value:busy.join("\n")||"-",
inline:true
}
);

await msg.edit({embeds:[embed]});

}catch{}

}

/* ================= MATCH PAIR ================= */

async function matchPair(){

const data = loadData();

const freeUsers = Object.entries(data.availability)
.filter(([_,v])=>v)
.map(([id])=>id);

const guild = await client.guilds.fetch(GUILD_ID);
const farmChannel = await guild.channels.fetch(FARM_CHANNEL_ID);

if(freeUsers.length <2){

await farmChannel.send(`⚠️ คนว่างไม่พอ (${freeUsers.length} คน)`);

return;

}

const weights={};

for(const id of freeUsers){

weights[id] = data.weeklyFarm[id]?1:5;

}

const u1 = weightedPick(freeUsers,weights);

const u2 = weightedPick(
freeUsers.filter(u=>u!==u1),
weights
);

data.currentPair=[u1,u2];

data.weeklyFarm[u1]=true;
data.weeklyFarm[u2]=true;

data.farmStatus={};

data.farmStatus[u1]={confirm:false};
data.farmStatus[u2]={confirm:false};

saveData(data);

const embed = new EmbedBuilder()
.setColor("#2b2d31")
.setTitle(`เวรฟาร์มประจำวันที่ ${displayDate()}`)
.setDescription(`• <@${u1}>\n• <@${u2}>`);

const row = new ActionRowBuilder().addComponents(

new ButtonBuilder()
.setCustomId("confirm_farm")
.setLabel("ยืนยันฟาร์มเสร็จ")
.setStyle(ButtonStyle.Primary)

);

await farmChannel.send({
content:`🚨 <@${u1}> <@${u2}> คุณถูกเลือกเป็นเวรฟาร์มวันนี้!`,
embeds:[embed],
components:[row]
});

}

/* ================= READY ================= */

client.once("clientReady", async()=>{

console.log("Bot Ready");

await rest.put(
Routes.applicationGuildCommands(client.user.id,GUILD_ID),
{body:commands}
);

const data = loadData();
const today = todayKey();

let needNew=false;

try{

const guild = await client.guilds.fetch(GUILD_ID);
const channel = await guild.channels.fetch(ANNOUNCE_CHANNEL_ID);

if(!data.statusMessageId) needNew=true;

if(data.statusDate!==today) needNew=true;

if(!needNew){

try{
await channel.messages.fetch(data.statusMessageId);
}catch{
needNew=true;
}

}

if(needNew){
console.log("Creating status embed");
await sendStatusPost();
}else{
console.log("Embed already exists");
}

}catch(e){
console.log("Startup check error",e);
}

/* ===== CRON ===== */

cron.schedule("59 23 * * *",async()=>{

const data=loadData();

data.statusClosed=true;
saveData(data);

await updateStatus();
await matchPair();

},{timezone:"Asia/Bangkok"});

cron.schedule("0 0 * * *",async()=>{

await sendStatusPost();

},{timezone:"Asia/Bangkok"});

cron.schedule("0 0 * * 1",async()=>{

const data=loadData();
data.weeklyFarm={};
saveData(data);

console.log("weekly reset");

},{timezone:"Asia/Bangkok"});

});

/* ================= INTERACTION ================= */

client.on("interactionCreate",async interaction=>{

const data=loadData();

if(interaction.isChatInputCommand()){

if(interaction.commandName==="fine"){

const fine=data.fines[interaction.user.id]||0;

return interaction.reply({
content:`💰 ค่าปรับสะสม: ${fine.toLocaleString()} IC`,
ephemeral:true
});

}

if(interaction.commandName==="leaderboard"){

const sorted=Object.entries(data.farmCount)
.sort((a,b)=>b[1]-a[1])
.slice(0,3);

if(!sorted.length)
return interaction.reply({
content:"ยังไม่มีข้อมูล",
ephemeral:true
});

const medal=["🥇","🥈","🥉"];

const desc=sorted
.map((u,i)=>`${medal[i]} <@${u[0]}> — **${u[1]} ครั้ง**`)
.join("\n");

const embed=new EmbedBuilder()
.setColor("#FFD700")
.setTitle("🏆 Leaderboard ฟาร์มเยอะสุด")
.setDescription(desc);

return interaction.reply({embeds:[embed]});

}

}

if(!interaction.isButton()) return;

if(data.statusClosed &&
(interaction.customId==="available"||
interaction.customId==="unavailable")){

return interaction.reply({
content:"⛔ ปิดรับสถานะแล้ว",
ephemeral:true
});

}

if(interaction.customId==="available")
data.availability[interaction.user.id]=true;

if(interaction.customId==="unavailable")
data.availability[interaction.user.id]=false;

if(interaction.customId==="confirm_farm"){

const pair=(data.currentPair||[]).map(String);

if(!pair.includes(String(interaction.user.id)))
return interaction.reply({
content:"⛔ วันนี้ไม่ใช่เวรของคุณ",
ephemeral:true
});

if(data.farmStatus[interaction.user.id]?.confirm)
return interaction.reply({
content:"⚠️ คุณยืนยันไปแล้ว",
ephemeral:true
});

data.farmStatus[interaction.user.id].confirm=true;

const [u1,u2]=data.currentPair;

const s1=data.farmStatus[u1]?.confirm?"✅ ยืนยันแล้ว":"❌ ยังไม่ยืนยัน";
const s2=data.farmStatus[u2]?.confirm?"✅ ยืนยันแล้ว":"❌ ยังไม่ยืนยัน";

const embed=new EmbedBuilder()
.setColor("#2b2d31")
.setTitle(`เวรฟาร์มประจำวันที่ ${displayDate()}`)
.setDescription(`• <@${u1}> — ${s1}\n• <@${u2}> — ${s2}`);

saveData(data);

await interaction.update({
embeds:[embed],
components:interaction.message.components
});

if(data.farmStatus[u1]?.confirm &&
data.farmStatus[u2]?.confirm){

await interaction.followUp({
content:"🎉 ทั้งคู่ยืนยันฟาร์มครบแล้ว!"
});

}

return;

}

saveData(data);
await updateStatus();

interaction.reply({
content:"บันทึกแล้ว",
ephemeral:true
});

});

/* ================= ERROR HANDLER ================= */

process.on("unhandledRejection",(err)=>{
console.error("Unhandled rejection:",err);
});

process.on("uncaughtException",(err)=>{
console.error("Uncaught exception:",err);
});

/* ================= LOGIN ================= */

client.login(TOKEN);
