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
const ADMIN_CHANNEL_ID = "1472992506655412365";
const REQUIRED_ROLE_ID = "1402559873257832508";

const FINE_AMOUNT = 100000;
/* ========================================= */

/* ================= EXPRESS ================= */
const app = express();
app.get("/", (_, res) => res.send("Bot is running"));
app.listen(process.env.PORT || 3000);
/* ========================================= */

/* ================= DATA ================= */
const DATA_FILE = "/app/data/data.json";

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.ensureFileSync(DATA_FILE);
    fs.writeJsonSync(DATA_FILE, {
      availability: {},
      statusClosed: false,
      statusMessageId: null,
      weights: {},
      currentPair: null,
      farmStatus: {},
      fines: {}
    });
  }
  return fs.readJsonSync(DATA_FILE);
}

function saveData(data) {
  fs.writeJsonSync(DATA_FILE, data, { spaces: 2 });
}
/* ========================================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

/* ================= SLASH ================= */

const commands = [
  new SlashCommandBuilder()
    .setName("fine")
    .setDescription("ดูยอดค่าปรับสะสม")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );
}

/* ================= WEIGHTED ================= */

function weightedPick(users, weights) {
  const total = users.reduce((s, id) => s + (weights[id] || 1), 0);
  let r = Math.random() * total;
  for (const id of users) {
    r -= (weights[id] || 1);
    if (r <= 0) return id;
  }
}

/* ================= STATUS POST ================= */

async function sendStatusPost() {
  const guild = client.guilds.cache.get(GUILD_ID);
  const channel = guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);
  const data = loadData();

  if (data.statusMessageId) {
    try {
      await channel.messages.fetch(data.statusMessageId);
      return;
    } catch {}
  }

  const embed = new EmbedBuilder()
    .setColor("#2B8AF7")
    .setTitle("📋 ลงสถานะเวรฟาร์มวันนี้")
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
  saveData(data);
}

async function updateStatusEmbed() {
  const data = loadData();
  const guild = client.guilds.cache.get(GUILD_ID);
  const channel = guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);

  if (!data.statusMessageId) return;

  const msg = await channel.messages.fetch(data.statusMessageId);

  const available = [];
  const unavailable = [];

  for (const [id, v] of Object.entries(data.availability)) {
    if (v) available.push(`<@${id}>`);
    else unavailable.push(`<@${id}>`);
  }

  const embed = new EmbedBuilder()
    .setColor(data.statusClosed ? "#6c757d" : "#2B8AF7")
    .setTitle(`📋 ระบบลงสถานะเวรฟาร์มประจำวันที่ ${nextDay}`)
    .setDescription(data.statusClosed ? "🔒 ปิดรับแล้ว" : "กดเลือกสถานะของคุณ\n⏳ ปิดรับ 23:59")
    .addFields(
      { name: `🟢 ว่าง (${available.length})`, value: available.join("\n") || "-", inline: true },
      { name: `🔴 ไม่ว่าง (${unavailable.length})`, value: unavailable.join("\n") || "-", inline: true }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("available")
      .setLabel("ว่าง")
      .setStyle(ButtonStyle.Success)
      .setDisabled(data.statusClosed),
    new ButtonBuilder()
      .setCustomId("unavailable")
      .setLabel("ไม่ว่าง")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(data.statusClosed)
  );

  await msg.edit({ embeds: [embed], components: [row] });
}

/* ================= MATCH ================= */

async function matchPair() {
  const data = loadData();
  const guild = client.guilds.cache.get(GUILD_ID);
  const admin = guild.channels.cache.get(ADMIN_CHANNEL_ID);
  const announce = guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);

  if (data.currentPair) return;

  const availableUsers = Object.entries(data.availability)
    .filter(([_, v]) => v)
    .map(([id]) => id);

  if (availableUsers.length < 2) {
    await admin.send("⚠️ คนว่างไม่พอสำหรับจับคู่");
    return;
  }

  const u1 = weightedPick(availableUsers, data.weights);
  const u2 = weightedPick(availableUsers.filter(u => u !== u1), data.weights);

  data.currentPair = [u1, u2];

  data.weights[u1] = 1;
  data.weights[u2] = 1;

  availableUsers.forEach(id => {
    if (!data.currentPair.includes(id))
      data.weights[id] = (data.weights[id] || 1) + 1;
  });

  data.farmStatus[u1] = { proof: false, confirm: false, missed: 0 };
  data.farmStatus[u2] = { proof: false, confirm: false, missed: 0 };

  saveData(data);

  const today = moment().tz("Asia/Bangkok").format("DD/MM/YYYY");
  
  const embed = new EmbedBuilder()
    .setColor("#00c853")
    .setTitle(`🎯 เวรฟาร์มประจำวันที่ ${today}`)
    .setDescription(
  `- <@${u1}>\n- <@${u2}>`
)
    .addFields({
      name: "เงื่อนไข",
      value: "ส่งรูปหลักฐาน (ไม้ 500 + เหล็ก 500)\nแล้วกดยืนยันฟาร์มเสร็จ"
    });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("confirm_farm").setLabel("ยืนยันฟาร์มเสร็จ").setStyle(ButtonStyle.Primary)
  );

  await announce.send({ embeds: [embed], components: [row] });
}

/* ================= EVENTS ================= */

client.once("clientReady", async () => {
  await registerCommands();
  await sendStatusPost();

  cron.schedule("0 0 * * *", async () => {
    const data = loadData();
    data.statusClosed = false;
    data.availability = {};
    data.currentPair = null;
    saveData(data);
    await sendStatusPost();
  }, { timezone: "Asia/Bangkok" });

  cron.schedule("59 23 * * *", async () => {
    const data = loadData();
    data.statusClosed = true;
    saveData(data);
    await updateStatusEmbed();
    await matchPair();
  }, { timezone: "Asia/Bangkok" });
});

client.on("interactionCreate", async interaction => {
  const data = loadData();

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "fine") {
      const fine = data.fines[interaction.user.id] || 0;
      return interaction.reply({
        content: `💰 ค่าปรับสะสม: ${fine.toLocaleString()} IC`,
        flags: 64
      });
    }
  }

  if (!interaction.isButton()) return;

  if (interaction.customId === "available") {
    data.availability[interaction.user.id] = true;
  }

  if (interaction.customId === "unavailable") {
    data.availability[interaction.user.id] = false;
  }

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

client.on("messageCreate", async message => {
  if (message.author.bot) return;
  const data = loadData();
  if (!data.currentPair) return;
  if (!data.currentPair.includes(message.author.id)) return;
  if (message.attachments.size === 0) return;

  const guild = client.guilds.cache.get(GUILD_ID);
  const admin = guild.channels.cache.get(ADMIN_CHANNEL_ID);

  const attachment = message.attachments.first();
  const url = attachment.url;

  data.farmStatus[message.author.id].proof = true;
  saveData(data);

  await admin.send({
    content: `📸 หลักฐานจาก <@${message.author.id}>`,
    files: [url]
  });

  await message.delete().catch(() => {});
  await message.author.send("✅ รับหลักฐานแล้ว");
});

client.login(TOKEN);
