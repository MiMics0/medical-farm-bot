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
const DATA_FILE = "./data.json";

function loadData() {
  if (!fs.existsSync(DATA_FILE)) fs.writeJsonSync(DATA_FILE, {});
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
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

/* ---------- Slash Commands ---------- */
const commands = [
  new SlashCommandBuilder().setName("test").setDescription("ทดสอบบอท"),
  new SlashCommandBuilder().setName("fine").setDescription("ดูยอดค่าปรับสะสม"),
  new SlashCommandBuilder().setName("leaderboard").setDescription("อันดับการฟาร์มประจำสัปดาห์")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );
}

/* ================= STATUS SYSTEM ================= */

async function sendDailyAvailabilityPost() {
  const guild = client.guilds.cache.get(GUILD_ID);
  const channel = guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);

  let data = loadData();

  // 🔥 ลบ Embed เก่าอัตโนมัติ
  if (data.statusMessageId) {
    try {
      const oldMsg = await channel.messages.fetch(data.statusMessageId);
      await oldMsg.delete();
    } catch {}
  }

  data.availability = {};
  data.statusClosed = false;

  const nextDate = moment().tz("Asia/Bangkok").add(1, "day").format("DD/MM/YYYY");

  const embed = new EmbedBuilder()
    .setColor("#2B8AF7")
    .setTitle(`📋 ระบบลงสถานะเวรฟาร์มประจำวันที่ ${nextDate}`)
    .setDescription("กรุณาเลือกสถานะของท่านด้านล่าง\n⏳ ปิดรับเวลา 23:59")
    .addFields(
      { name: "🟢 ว่าง (0)", value: "-", inline: true },
      { name: "🔴 ไม่ว่าง (0)", value: "-", inline: true }
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("available").setLabel("ว่าง").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("unavailable").setLabel("ไม่ว่าง").setStyle(ButtonStyle.Danger)
  );

  const message = await channel.send({
    content: `📌 <@&${REQUIRED_ROLE_ID}>`,
    embeds: [embed],
    components: [row]
  });

  data.statusMessageId = message.id;
  saveData(data);
}

async function updateAvailabilityEmbed(closed = false) {
  const guild = client.guilds.cache.get(GUILD_ID);
  const channel = guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);
  const data = loadData();
  if (!data.statusMessageId) return;

  const message = await channel.messages.fetch(data.statusMessageId);

  const available = [];
  const unavailable = [];

  for (const [userId, status] of Object.entries(data.availability || {})) {
    if (status) available.push(`<@${userId}>`);
    else unavailable.push(`<@${userId}>`);
  }

  const nextDate = moment().tz("Asia/Bangkok").add(1, "day").format("DD/MM/YYYY");

  const embed = new EmbedBuilder()
    .setColor(closed ? "#6c757d" : "#2B8AF7")
    .setTitle(`📋 ระบบลงสถานะเวรฟาร์มประจำวันที่ ${nextDate}`)
    .setDescription(
      closed
        ? "🔒 ปิดรับการลงสถานะแล้ว"
        : "กรุณาเลือกสถานะของท่านด้านล่าง\n⏳ ปิดรับเวลา 23:59"
    )
    .addFields(
      {
        name: `🟢 ว่าง (${available.length})`,
        value: available.length ? available.join("\n") : "-",
        inline: true
      },
      {
        name: `🔴 ไม่ว่าง (${unavailable.length})`,
        value: unavailable.length ? unavailable.join("\n") : "-",
        inline: true
      }
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("available")
      .setLabel("ว่าง")
      .setStyle(ButtonStyle.Success)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId("unavailable")
      .setLabel("ไม่ว่าง")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(closed)
  );

  await message.edit({ embeds: [embed], components: [row] });
}

/* ========================================= */

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();

  await sendDailyAvailabilityPost();

  // 🔒 ปิดระบบ 23:59
  cron.schedule(
    "59 23 * * *",
    async () => {
      let data = loadData();
      data.statusClosed = true;
      saveData(data);
      await updateAvailabilityEmbed(true);
    },
    { timezone: "Asia/Bangkok" }
  );

  // 🔓 เปิดระบบใหม่ 00:00
  cron.schedule(
    "0 0 * * *",
    async () => {
      await sendDailyAvailabilityPost();
    },
    { timezone: "Asia/Bangkok" }
  );
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {
  let data = loadData();

  if (!interaction.isButton()) return;
  const member = interaction.member;

  if (data.statusClosed)
    return interaction.reply({ content: "🔒 ปิดรับการลงสถานะแล้ว", flags: 64 });

  if (interaction.customId === "available") {
    if (!member.roles.cache.has(REQUIRED_ROLE_ID))
      return interaction.reply({ content: "⛔ คุณไม่มียศที่อนุญาต", flags: 64 });

    data.availability = data.availability || {};
    data.availability[member.id] = true;
    saveData(data);

    await updateAvailabilityEmbed();
    return interaction.reply({ content: "✅ บันทึกสถานะ: ว่าง", flags: 64 });
  }

  if (interaction.customId === "unavailable") {
    data.availability = data.availability || {};
    data.availability[member.id] = false;
    saveData(data);

    await updateAvailabilityEmbed();
    return interaction.reply({ content: "❌ บันทึกสถานะ: ไม่ว่าง", flags: 64 });
  }
});

client.login(TOKEN);
