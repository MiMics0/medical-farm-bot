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

function getToday() {
  return moment().tz("Asia/Bangkok").format("YYYY-MM-DD");
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
  new SlashCommandBuilder().setName("fine").setDescription("ดูยอดค่าปรับสะสม")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );
}
/* ---------------------------------- */

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();

  await sendDailyAvailabilityPost();

  cron.schedule(
    "0 0 * * *",
    async () => {
      await runDailyMatch();
      await sendDailyAvailabilityPost();
    },
    { timezone: "Asia/Bangkok" }
  );

  cron.schedule(
    "59 23 * * *",
    applyDailyFines,
    { timezone: "Asia/Bangkok" }
  );
});

/* ================= DAILY POST ================= */
async function sendDailyAvailabilityPost() {
  const guild = client.guilds.cache.get(GUILD_ID);
  const channel = guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);

  // 👉 วันที่ของวันถัดไป
  const nextDate = moment()
    .tz("Asia/Bangkok")
    .add(1, "day")
    .format("DD/MM/YYYY");

  const embed = new EmbedBuilder()
    .setColor("#2B8AF7")
    .setTitle(`📋 ระบบลงสถานะเวรฟาร์มประจำวันที่ ${nextDate}`)
    .setDescription("กรุณาเลือกสถานะของท่านด้านล่าง")
    .addFields(
      { name: "🟢 ว่าง", value: "สามารถเข้าปฏิบัติหน้าที่ได้", inline: true },
      { name: "🔴 ไม่ว่าง", value: "ไม่สามารถเข้าปฏิบัติหน้าที่", inline: true }
    )
    .setFooter({ text: "Medical Farm Duty System" })
    .setTimestamp();

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

  await channel.send({
    content: `📌 <@&${REQUIRED_ROLE_ID}>`,
    embeds: [embed],
    components: [row]
  });
}
/* ========================================= */

/* ================= MATCH ================= */
async function runDailyMatch() {
  const guild = client.guilds.cache.get(GUILD_ID);
  const channel = guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);
  const adminChannel = guild.channels.cache.get(ADMIN_CHANNEL_ID);

  let data = loadData();
  const today = getToday();

  const availableIds = Object.entries(data.availability || {})
    .filter(([_, v]) => v === true)
    .map(([id]) => id);

  if (availableIds.length < 2) {
    await adminChannel.send("⚠️ วันนี้มีผู้ลงว่างไม่เพียงพอ");
    data.availability = {};
    saveData(data);
    return;
  }

  const pair = availableIds.sort(() => 0.5 - Math.random()).slice(0, 2);

  data.today = { date: today, pair, proofs: {} };
  data.availability = {};
  saveData(data);

  const embed = new EmbedBuilder()
    .setColor("#00C851")
    .setTitle("📅 ประกาศเวรฟาร์มประจำวัน")
    .setDescription(pair.map(id => `<@${id}>`).join("\n"))
    .addFields({
      name: "⚠ เงื่อนไข",
      value: `ไม่ส่งหลักฐาน ปรับ ${FINE_AMOUNT.toLocaleString()} IC / วัน`
    })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("send_proof")
      .setLabel("ส่งหลักฐานการฟาร์ม")
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [row] });
}
/* ========================================= */

/* ================= FINES ================= */
async function applyDailyFines() {
  let data = loadData();
  if (!data.today?.pair) return;

  const guild = client.guilds.cache.get(GUILD_ID);
  const adminChannel = guild.channels.cache.get(ADMIN_CHANNEL_ID);

  data.fines = data.fines || {};

  for (const userId of data.today.pair) {
    if (!data.today.proofs[userId]) {
      data.fines[userId] = (data.fines[userId] || 0) + FINE_AMOUNT;

      const embed = new EmbedBuilder()
        .setColor("#FF4444")
        .setTitle("💸 แจ้งเตือนค่าปรับเวรฟาร์ม")
        .setDescription(`<@${userId}> ไม่ส่งหลักฐาน`)
        .addFields({
          name: "ยอดสะสม",
          value: `${data.fines[userId].toLocaleString()} IC`
        })
        .setTimestamp();

      await adminChannel.send({ embeds: [embed] });

      try {
        const member = await guild.members.fetch(userId);
        await member.send({ embeds: [embed] });
      } catch {}
    }
  }

  saveData(data);
}
/* ========================================= */

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {
  let data = loadData();

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "test")
      return interaction.reply({ content: "✅ Bot ทำงานปกติ", flags: 64 });

    if (interaction.commandName === "fine") {
      const total = data.fines?.[interaction.user.id] || 0;
      return interaction.reply({
        content: `💸 ค่าปรับสะสม: ${total.toLocaleString()} IC`,
        flags: 64
      });
    }
  }

  if (!interaction.isButton()) return;

  const member = interaction.member;

  if (interaction.customId === "available") {
    if (!member.roles.cache.has(REQUIRED_ROLE_ID))
      return interaction.reply({ content: "⛔ คุณไม่มียศที่อนุญาต", flags: 64 });

    data.availability = data.availability || {};
    data.availability[member.id] = true;
    saveData(data);

    return interaction.reply({ content: "✅ บันทึกสถานะ: ว่าง", flags: 64 });
  }

  if (interaction.customId === "unavailable") {
    data.availability = data.availability || {};
    data.availability[member.id] = false;
    saveData(data);

    return interaction.reply({ content: "❌ บันทึกสถานะ: ไม่ว่าง", flags: 64 });
  }
});
/* ========================================= */

client.login(TOKEN);


