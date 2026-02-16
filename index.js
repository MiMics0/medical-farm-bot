import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from "discord.js";
import cron from "node-cron";
import moment from "moment-timezone";
import fs from "fs-extra";

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const ANNOUNCE_CHANNEL_NAME = "『📢』 ประกาศเวรฟาร์ม";
const ADMIN_CHANNEL_NAME = "『📍』 รวมมิตรแจ้งเตือนฟาร์ม";
const MEDICAL_ROLE_NAME = "Medical✨";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

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

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  cron.schedule("0 0 * * *", async () => {
    await runDailyMatch();
  }, {
    timezone: "Asia/Bangkok"
  });
});

async function runDailyMatch() {
  const guild = client.guilds.cache.get(GUILD_ID);
  const announceChannel = guild.channels.cache.find(c => c.name === ANNOUNCE_CHANNEL_NAME);
  const adminChannel = guild.channels.cache.find(c => c.name === ADMIN_CHANNEL_NAME);

  let data = loadData();
  const today = getToday();

  const availableIds = Object.entries(data.availability)
    .filter(([id, status]) => status === true)
    .map(([id]) => id);

  if (availableIds.length < 2) {
    await adminChannel.send("⚠️ วันนี้ไม่มีผู้กดว่างเพียงพอสำหรับการจับคู่");
    data.availability = {};
    saveData(data);
    return;
  }

  const filtered = availableIds.filter(id => !data.weeklyUsed.includes(id));
  const pool = filtered.length >= 2 ? filtered : availableIds;

  const shuffled = pool.sort(() => 0.5 - Math.random());
  const pair = shuffled.slice(0, 2);

  pair.forEach(id => {
    if (!data.totalCount[id]) data.totalCount[id] = 0;
    data.totalCount[id]++;
    data.weeklyUsed.push(id);
  });

  if (data.weeklyUsed.length >= 14) {
    data.weeklyUsed = [];
  }

  data.today = {
    date: today,
    pair: pair,
    proofs: {}
  };

  data.availability = {};
  saveData(data);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("send_proof")
      .setLabel("📸 ส่งหลักฐานการฟาร์ม")
      .setStyle(ButtonStyle.Primary)
  );

  const mentions = pair.map(id => `<@${id}>`).join("\n");

  await announceChannel.send({
    content: `📅 เวรฟาร์มวันนี้\n\n👥 ผู้รับผิดชอบ:\n${mentions}\n\n🎯 เป้าหมาย:\nไม้ 500\nเหล็ก 500\n\n⏰ ส่งก่อน 23:59`,
    components: [row]
  });
}

client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  const guild = interaction.guild;
  const member = interaction.member;
  const adminChannel = guild.channels.cache.find(c => c.name === ADMIN_CHANNEL_NAME);

  let data = loadData();
  const today = getToday();

  if (interaction.customId === "send_proof") {
    if (!data.today || data.today.date !== today) {
      return interaction.reply({ content: "⛔ หมดเวลาส่งหลักฐานแล้ว", ephemeral: true });
    }

    if (!data.today.pair.includes(member.id)) {
      return interaction.reply({ content: "⛔ คุณไม่ได้ถูกมอบหมายวันนี้", ephemeral: true });
    }

    if (data.today.proofs[member.id]) {
      return interaction.reply({ content: "⚠️ คุณส่งหลักฐานแล้ววันนี้", ephemeral: true });
    }

    await interaction.reply({
      content: "📎 กรุณาอัปโหลดรูปหลักฐานในข้อความถัดไป",
      ephemeral: true
    });

    const filter = m => m.author.id === member.id && m.attachments.size > 0;

    const collector = interaction.channel.createMessageCollector({
      filter,
      max: 1,
      time: 60000
    });

    collector.on("collect", async msg => {
      const images = msg.attachments.map(a => a.url);
      data.today.proofs[member.id] = images;
      saveData(data);

      await interaction.followUp({ content: "✅ บันทึกหลักฐานเรียบร้อย", ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle("📸 หลักฐานเวรฟาร์ม")
        .setDescription(`ผู้ส่ง: <@${member.id}>`)
        .setColor("Green");

      await adminChannel.send({ embeds: [embed], files: images });
    });
  }
});

client.login(TOKEN);
