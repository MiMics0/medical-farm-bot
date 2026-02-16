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

// ================= CONFIG =================
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const ANNOUNCE_CHANNEL_NAME = "『📢』 ประกาศเวรฟาร์ม";
const ADMIN_CHANNEL_NAME = "『📍』 รวมมิตรแจ้งเตือนฟาร์ม";

// ใช้ Role ID แทนชื่อ
const REQUIRED_ROLE_ID = "1402559873257832508";

// ค่าปรับ
const FINE_AMOUNT = 100000; // IC ต่อวัน
// =========================================

// ================= EXPRESS =================
const app = express();
app.get("/", (_, res) => res.send("Bot is running"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
// =========================================

// ================= DATA =================
const DATA_FILE = "./data.json";

function loadData() {
  return fs.readJsonSync(DATA_FILE);
}
function saveData(data) {
  fs.writeJsonSync(DATA_FILE, data, { spaces: 2 });
}
function getToday() {
  return moment().tz("Asia/Bangkok").format("YYYY-MM-DD");
}
// =========================================

// ================= DISCORD =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

// ---------- Slash Commands ----------
const commands = [
  new SlashCommandBuilder()
    .setName("test")
    .setDescription("ทดสอบบอทเวรฟาร์ม"),
  new SlashCommandBuilder()
    .setName("fine")
    .setDescription("ดูยอดค่าปรับสะสมของคุณ")
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );
  console.log("Registered Slash Commands");
}
// ----------------------------------------

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();

  const guild = client.guilds.cache.get(GUILD_ID);
  const announceChannel = guild.channels.cache.find(
    c => c.name === ANNOUNCE_CHANNEL_NAME
  );

  const availabilityRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("available")
      .setLabel("✅ ว่าง")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("unavailable")
      .setLabel("❌ ไม่ว่าง")
      .setStyle(ButtonStyle.Danger)
  );

  await announceChannel.send({
    content: "📋 ลงสถานะฟาร์มวันนี้ (เฉพาะแพทย์ที่ได้รับสิทธิ์)",
    components: [availabilityRow]
  });

  // จับคู่เที่ยงคืน
  cron.schedule(
    "0 0 * * *",
    async () => await runDailyMatch(),
    { timezone: "Asia/Bangkok" }
  );

  // คิดค่าปรับทุกวัน 23:59
  cron.schedule(
    "59 23 * * *",
    async () => await applyDailyFines(),
    { timezone: "Asia/Bangkok" }
  );
});

// ================= MATCH =================
async function runDailyMatch() {
  const guild = client.guilds.cache.get(GUILD_ID);
  const announceChannel = guild.channels.cache.find(
    c => c.name === ANNOUNCE_CHANNEL_NAME
  );
  const adminChannel = guild.channels.cache.find(
    c => c.name === ADMIN_CHANNEL_NAME
  );

  let data = loadData();
  const today = getToday();

  const availableIds = Object.entries(data.availability || {})
    .filter(([_, status]) => status === true)
    .map(([id]) => id);

  if (availableIds.length < 2) {
    await adminChannel.send("⚠️ วันนี้ไม่มีแพทย์ลงว่างเพียงพอ");
    data.availability = {};
    saveData(data);
    return;
  }

  const pair = availableIds.sort(() => 0.5 - Math.random()).slice(0, 2);

  data.today = {
    date: today,
    pair,
    proofs: {}
  };
  data.availability = {};
  saveData(data);

  const proofRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("send_proof")
      .setLabel("📸 ส่งหลักฐานการฟาร์ม")
      .setStyle(ButtonStyle.Primary)
  );

  await announceChannel.send({
    content:
      `📅 เวรฟาร์มวันนี้\n\n` +
      pair.map(id => `<@${id}>`).join("\n") +
      `\n\n💸 ไม่ส่งหลักฐาน ปรับ 100,000 IC / วัน`,
    components: [proofRow]
  });
}
// =========================================

// ================= APPLY FINES =================
async function applyDailyFines() {
  let data = loadData();
  if (!data.today?.pair) return;

  const guild = client.guilds.cache.get(GUILD_ID);
  const adminChannel = guild.channels.cache.find(
    c => c.name === ADMIN_CHANNEL_NAME
  );

  data.fines = data.fines || {};

  for (const userId of data.today.pair) {
    if (!data.today.proofs[userId]) {
      // เพิ่มค่าปรับ
      data.fines[userId] = (data.fines[userId] || 0) + FINE_AMOUNT;

      // แจ้งห้องยศสูง
      await adminChannel.send(
        `💸 <@${userId}> ไม่ส่งหลักฐานเวรฟาร์ม\nปรับ ${FINE_AMOUNT.toLocaleString()} IC\nยอดสะสม: ${data.fines[userId].toLocaleString()} IC`
      );

      // ส่ง DM แจ้งเตือน
      try {
        const member = await guild.members.fetch(userId);
        await member.send(
          `🚨 แจ้งเตือนค่าปรับเวรฟาร์ม\n\n` +
          `คุณไม่ส่งหลักฐานการฟาร์มในวันนี้\n` +
          `ถูกปรับ ${FINE_AMOUNT.toLocaleString()} IC\n` +
          `ยอดค่าปรับสะสม: ${data.fines[userId].toLocaleString()} IC\n\n` +
          `⚠️ ระบบจะคิดค่าปรับทุกวันจนกว่าจะส่งหลักฐาน`
        );
      } catch (err) {
        console.log(`DM failed for ${userId}`);
      }
    }
  }

  saveData(data);
}
// =========================================

// ================= INTERACTIONS =================
client.on("interactionCreate", async interaction => {
  // Slash
  if (interaction.isChatInputCommand()) {
    let data = loadData();

    if (interaction.commandName === "test") {
      return interaction.reply({
        content: "✅ Farm Duty Bot พร้อมทำงาน",
        ephemeral: true
      });
    }

    if (interaction.commandName === "fine") {
      const total = data.fines?.[interaction.user.id] || 0;
      return interaction.reply({
        content: `💸 ค่าปรับสะสมของคุณ: ${total.toLocaleString()} IC`,
        ephemeral: true
      });
    }
  }

  // Buttons
  if (!interaction.isButton()) return;

  let data = loadData();
  const member = interaction.member;

  // กดว่าง (ตรวจ Role ID)
  if (interaction.customId === "available") {
    if (!member.roles.cache.has(REQUIRED_ROLE_ID)) {
      return interaction.reply({
        content: "⛔ คุณไม่มีสิทธิ์ลงเวรฟาร์ม",
        ephemeral: true
      });
    }

    data.availability = data.availability || {};
    data.availability[member.id] = true;
    saveData(data);

    return interaction.reply({
      content: "✅ ลงว่าว่างแล้ว",
      ephemeral: true
    });
  }

  if (interaction.customId === "unavailable") {
    data.availability = data.availability || {};
    data.availability[member.id] = false;
    saveData(data);

    return interaction.reply({
      content: "❌ ลงว่าไม่ว่างแล้ว",
      ephemeral: true
    });
  }

  // ส่งหลักฐาน
  if (interaction.customId === "send_proof") {
    const today = getToday();

    if (!data.today || data.today.date !== today)
      return interaction.reply({ content: "⛔ หมดเวลาส่งหลักฐานแล้ว", ephemeral: true });

    if (!data.today.pair.includes(member.id))
      return interaction.reply({ content: "⛔ วันนี้ไม่ใช่เวรของคุณ", ephemeral: true });

    await interaction.reply({
      content: "📎 กรุณาอัปโหลดรูปหลักฐานภายใน 1 นาที",
      ephemeral: true
    });

    const filter = m => m.author.id === member.id && m.attachments.size > 0;
    const collector = interaction.channel.createMessageCollector({
      filter,
      max: 1,
      time: 60000
    });

    collector.on("collect", async msg => {
      const images = [...msg.attachments.values()].map(a => a.url);
      data.today.proofs[member.id] = images;
      saveData(data);

      await interaction.followUp({
        content: "✅ บันทึกหลักฐานเรียบร้อย ค่าปรับจะหยุดนับ",
        ephemeral: true
      });
    });
  }
});
// =========================================

client.login(TOKEN);
