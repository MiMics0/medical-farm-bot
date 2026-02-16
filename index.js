import express from "express";
import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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

const ANNOUNCE_CHANNEL_ID = "1472992266464526549";
const ADMIN_CHANNEL_ID = "1472992506655412365";
const REQUIRED_ROLE_ID = "1402559873257832508";

const FINE_AMOUNT = 100000;
// =========================================

// ================= EXPRESS =================
const app = express();
app.get("/", (_, res) => res.send("Bot is running"));
const PORT = process.env.PORT || 3000;
app.listen(PORT);
// =========================================

// ================= DATA =================
const DATA_FILE = "./data.json";

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeJsonSync(DATA_FILE, {});
  }
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
    .setDescription("ทดสอบบอท"),
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
// ----------------------------------------

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();

  const guild = client.guilds.cache.get(GUILD_ID);
  const announceChannel = guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);

  const row = new ActionRowBuilder().addComponents(
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
    content: "📋 กดลงสถานะเวรฟาร์มวันนี้",
    components: [row]
  });

  cron.schedule("0 0 * * *", runDailyMatch, {
    timezone: "Asia/Bangkok"
  });

  cron.schedule("59 23 * * *", applyDailyFines, {
    timezone: "Asia/Bangkok"
  });
});

// ================= MATCH =================
async function runDailyMatch() {
  const guild = client.guilds.cache.get(GUILD_ID);
  const announceChannel = guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);
  const adminChannel = guild.channels.cache.get(ADMIN_CHANNEL_ID);

  let data = loadData();
  const today = getToday();

  const availableIds = Object.entries(data.availability || {})
    .filter(([_, v]) => v === true)
    .map(([id]) => id);

  if (availableIds.length < 2) {
    await adminChannel.send("⚠️ วันนี้แพทย์ลงว่างไม่พอ");
    data.availability = {};
    saveData(data);
    return;
  }

  const pair = availableIds.sort(() => 0.5 - Math.random()).slice(0, 2);

  data.today = { date: today, pair, proofs: {} };
  data.availability = {};
  saveData(data);

  const proofRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("send_proof")
      .setLabel("📸 ส่งหลักฐาน")
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

// ================= FINES =================
async function applyDailyFines() {
  let data = loadData();
  if (!data.today?.pair) return;

  const guild = client.guilds.cache.get(GUILD_ID);
  const adminChannel = guild.channels.cache.get(ADMIN_CHANNEL_ID);

  data.fines = data.fines || {};

  for (const userId of data.today.pair) {
    if (!data.today.proofs[userId]) {
      data.fines[userId] = (data.fines[userId] || 0) + FINE_AMOUNT;

      await adminChannel.send(
        `💸 <@${userId}> ไม่ส่งหลักฐาน\n` +
        `ปรับ ${FINE_AMOUNT.toLocaleString()} IC\n` +
        `ยอดสะสม: ${data.fines[userId].toLocaleString()} IC`
      );

      try {
        const member = await guild.members.fetch(userId);
        await member.send(
          `🚨 แจ้งเตือนค่าปรับเวรฟาร์ม\n\n` +
          `คุณไม่ส่งหลักฐานวันนี้\n` +
          `ปรับ ${FINE_AMOUNT.toLocaleString()} IC\n` +
          `ยอดสะสม: ${data.fines[userId].toLocaleString()} IC`
        );
      } catch {}
    }
  }

  saveData(data);
}
// =========================================

// ================= INTERACTION =================
client.on("interactionCreate", async interaction => {
  let data = loadData();

  // Slash
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "test") {
      return interaction.reply({
        content: "✅ Bot ทำงานปกติ",
        ephemeral: true
      });
    }

    if (interaction.commandName === "fine") {
      const total = data.fines?.[interaction.user.id] || 0;
      return interaction.reply({
        content: `💸 ค่าปรับสะสม: ${total.toLocaleString()} IC`,
        ephemeral: true
      });
    }
  }

  if (!interaction.isButton()) return;

  const member = interaction.member;

  // ====== กดว่าง ======
  if (interaction.customId === "available") {
    if (!member.roles.cache.has(REQUIRED_ROLE_ID)) {
      return interaction.reply({
        content: "⛔ คุณไม่มียศที่อนุญาต",
        ephemeral: true
      });
    }

    data.availability = data.availability || {};
    data.availability[member.id] = true;
    saveData(data);

    const announceChannel = interaction.guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);

    await announceChannel.send(
      `📌 <@&${REQUIRED_ROLE_ID}>\n` +
      `✅ <@${member.id}> ลงว่าว่างแล้ว`
    );

    return interaction.reply({
      content: "✅ ลงว่าว่างแล้ว",
      ephemeral: true
    });
  }

  // ====== กดไม่ว่าง ======
  if (interaction.customId === "unavailable") {
    data.availability = data.availability || {};
    data.availability[member.id] = false;
    saveData(data);

    const announceChannel = interaction.guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);

    await announceChannel.send(
      `📌 <@&${REQUIRED_ROLE_ID}>\n` +
      `❌ <@${member.id}> ลงว่าไม่ว่าง`
    );

    return interaction.reply({
      content: "❌ ลงว่าไม่ว่างแล้ว",
      ephemeral: true
    });
  }

  // ====== ส่งหลักฐาน ======
  if (interaction.customId === "send_proof") {
    const today = getToday();

    if (!data.today || data.today.date !== today)
      return interaction.reply({ content: "⛔ หมดเวลาแล้ว", ephemeral: true });

    if (!data.today.pair.includes(member.id))
      return interaction.reply({ content: "⛔ วันนี้ไม่ใช่เวรของคุณ", ephemeral: true });

    await interaction.reply({
      content: "📎 อัปโหลดรูปหลักฐานภายใน 1 นาที",
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
        content: "✅ บันทึกหลักฐานแล้ว ค่าปรับหยุดนับ",
        ephemeral: true
      });
    });
  }
});
// =========================================

client.login(TOKEN);
