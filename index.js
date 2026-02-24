import express from "express";
import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder
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

const DATA_FILE = "/app/data/data.json";
/* ========================================= */

/* ================= EXPRESS ================= */
const app = express();
app.get("/", (_, res) => res.send("Bot is running"));
app.listen(process.env.PORT || 3000);
/* ========================================= */

/* ================= DATA ================= */
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.ensureFileSync(DATA_FILE);
    fs.writeJsonSync(DATA_FILE, {});
  }

  const data = fs.readJsonSync(DATA_FILE);

  data.availability ??= {};
  data.statusClosed ??= false;
  data.statusMessageId ??= null;
  data.statusDate ??= null;
  data.weights ??= {};
  data.currentPair ??= null;
  data.farmStatus ??= {};
  data.fines ??= {};
  data.farmCount ??= {};

  return data;
}

function saveData(data) {
  fs.writeJsonSync(DATA_FILE, data, { spaces: 2 });
}
/* ========================================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ]
});

/* ================= COMMANDS ================= */

const commands = [
  new SlashCommandBuilder().setName("fine").setDescription("ดูยอดค่าปรับสะสม"),
  new SlashCommandBuilder().setName("leaderboard").setDescription("ดูอันดับคนฟาร์มเยอะที่สุด")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

/* ================= UTILS ================= */

function weightedPick(users, weights) {
  if (!users.length) return null;

  const total = users.reduce((s, id) => s + (weights[id] || 1), 0);
  let r = Math.random() * total;

  for (const id of users) {
    r -= (weights[id] || 1);
    if (r <= 0) return id;
  }

  return users[0];
}

function getTodayKey() {
  return moment().tz("Asia/Bangkok").format("YYYY-MM-DD");
}

function getDisplayDate() {
  return moment().tz("Asia/Bangkok").format("DD/MM/YYYY");
}

/* ================= STATUS ================= */

async function sendStatusPost() {
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(ANNOUNCE_CHANNEL_ID);
  if (!channel) return;

  const data = loadData();

  const embed = new EmbedBuilder()
    .setColor("#2B8AF7")
    .setTitle(`📋 ลงสถานะเวรฟาร์มประจำวันที่ ${getDisplayDate()}`)
    .setDescription("กดเลือกสถานะของคุณ\n⏳ ปิดรับ 23:59")
    .addFields(
      { name: "🟢 ว่าง (0)", value: "-", inline: true },
      { name: "🔴 ไม่ว่าง (0)", value: "-", inline: true }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("available").setLabel("ว่าง").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("unavailable").setLabel("ไม่ว่าง").setStyle(ButtonStyle.Danger)
  );

  const msg = await channel.send({
    content: `<@&${REQUIRED_ROLE_ID}>`,
    embeds: [embed],
    components: [row]
  });

  data.statusMessageId = msg.id;
  data.statusDate = getTodayKey();
  data.availability = {};
  data.statusClosed = false;
  data.currentPair = null;

  saveData(data);
}

async function updateStatusEmbed() {
  const data = loadData();
  if (!data.statusMessageId) return;

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(ANNOUNCE_CHANNEL_ID);
    const msg = await channel.messages.fetch(data.statusMessageId);

    const available = [];
    const unavailable = [];

    for (const [id, v] of Object.entries(data.availability)) {
      v ? available.push(`<@${id}>`) : unavailable.push(`<@${id}>`);
    }

    const embed = new EmbedBuilder()
      .setColor(data.statusClosed ? "#6c757d" : "#2B8AF7")
      .setTitle(`📋 ลงสถานะเวรฟาร์มประจำวันที่ ${getDisplayDate()}`)
      .setDescription(data.statusClosed ? "🔒 ปิดรับแล้ว" : "กดเลือกสถานะของคุณ\n⏳ ปิดรับ 23:59")
      .addFields(
        { name: `🟢 ว่าง (${available.length})`, value: available.join("\n") || "-", inline: true },
        { name: `🔴 ไม่ว่าง (${unavailable.length})`, value: unavailable.join("\n") || "-", inline: true }
      );

    await msg.edit({ embeds: [embed] });

  } catch {}
}

/* ================= MATCH ================= */

async function matchPair() {
  const data = loadData();

  const availableUsers = Object.entries(data.availability)
    .filter(([_, v]) => v)
    .map(([id]) => id);

  if (availableUsers.length < 2) return;

  const u1 = weightedPick(availableUsers, data.weights);
  const u2 = weightedPick(availableUsers.filter(u => u !== u1), data.weights);

  if (!u1 || !u2) return;

  data.currentPair = [u1, u2];
  data.farmStatus[u1] = { confirm: false };
  data.farmStatus[u2] = { confirm: false };

  saveData(data);

  const guild = await client.guilds.fetch(GUILD_ID);
  const farmChannel = await guild.channels.fetch(FARM_CHANNEL_ID);

  const embed = new EmbedBuilder()
    .setColor("#2b2d31")
    .setTitle(`เวรฟาร์มประจำวันที่ ${getDisplayDate()}`)
    .setDescription(`• <@${u1}>\n• <@${u2}>`)
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("confirm_farm")
      .setLabel("ยืนยันฟาร์มเสร็จ")
      .setStyle(ButtonStyle.Primary)
  );

  await farmChannel.send({
    content: `🚨 <@${u1}> <@${u2}> คุณถูกเลือกเป็นเวรฟาร์มวันนี้!`,
    embeds: [embed],
    components: [row]
  });
}

/* ================= READY ================= */

client.once("clientReady", async () => {

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );

  const data = loadData();

  if (data.statusDate !== getTodayKey()) {
    await sendStatusPost();
  }

  // 23:59 ปิดรับ + จับคู่
  cron.schedule("59 23 * * *", async () => {
    const data = loadData();
    data.statusClosed = true;
    saveData(data);
    await updateStatusEmbed();
    await matchPair();
  }, { timezone: "Asia/Bangkok" });

  // 00:00 รีเซ็ตวันใหม่
  cron.schedule("0 0 * * *", async () => {
    const data = loadData();

    if (data.currentPair) {
      data.currentPair.forEach(id => {
        if (data.farmStatus[id]?.confirm) {
          data.farmCount[id] = (data.farmCount[id] || 0) + 1;
        }
      });
    }

    saveData(data);
    await sendStatusPost();

  }, { timezone: "Asia/Bangkok" });

});

/* ================= INTERACTION ================= */

client.on("interactionCreate", async interaction => {

  const data = loadData();

  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "fine") {
      const fine = data.fines[interaction.user.id] || 0;
      return interaction.reply({ content: `💰 ค่าปรับสะสม: ${fine.toLocaleString()} IC`, flags: 64 });
    }

    if (interaction.commandName === "leaderboard") {
      const sorted = Object.entries(data.farmCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      if (!sorted.length)
        return interaction.reply({ content: "ยังไม่มีข้อมูลฟาร์ม", flags: 64 });

      const medals = ["🥇", "🥈", "🥉"];

      const desc = sorted
        .map((u, i) => `${medals[i]} <@${u[0]}> — **${u[1]} ครั้ง**`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setColor("#FFD700")
        .setTitle("🏆 Leaderboard ฟาร์มเยอะที่สุด")
        .setDescription(desc);

      return interaction.reply({ embeds: [embed] });
    }
  }

  if (!interaction.isButton()) return;

  if (interaction.customId === "available")
    data.availability[interaction.user.id] = true;

  if (interaction.customId === "unavailable")
    data.availability[interaction.user.id] = false;

  if (interaction.customId === "confirm_farm") {
    if (!data.currentPair?.includes(interaction.user.id))
      return interaction.reply({ content: "⛔ คุณไม่ใช่เวรฟาร์มวันนี้", flags: 64 });

    data.farmStatus[interaction.user.id].confirm = true;
    saveData(data);
    return interaction.reply({ content: "✅ ยืนยันแล้ว", flags: 64 });
  }

  saveData(data);
  await updateStatusEmbed();
  interaction.reply({ content: "บันทึกแล้ว", flags: 64 });
});

client.login(TOKEN);
