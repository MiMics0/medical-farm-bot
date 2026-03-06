const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const fs = require("fs");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const TOKEN = process.env.TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

const DATA_FILE = "./data.json";

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return {
      members: [],
      currentPair: [],
      pairDate: null,
      farmStatus: {}
    };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function formatDate() {
  const d = new Date();
  return d.toLocaleDateString("en-GB");
}

function buildEmbed(data) {

  const [a, b] = data.currentPair;

  const statusA = data.farmStatus[a]?.confirm ? "✅ ยืนยันแล้ว" : "❌ ยังไม่ยืนยัน";
  const statusB = data.farmStatus[b]?.confirm ? "✅ ยืนยันแล้ว" : "❌ ยังไม่ยืนยัน";

  return new EmbedBuilder()
    .setTitle(`เวรฟาร์มประจำวันที่ ${data.pairDate}`)
    .setDescription(
`• <@${a}> — ${statusA}
• <@${b}> — ${statusB}`
    );
}

client.on("interactionCreate", async interaction => {

  if (!interaction.isButton()) return;

  const data = loadData();

  if (interaction.customId === "confirm_farm") {

    if (!data.currentPair.includes(interaction.user.id)) {
      return interaction.reply({
        content: "⛔ คุณไม่ใช่เวรฟาร์มวันนี้",
        flags: 64
      });
    }

    if (!data.farmStatus[interaction.user.id]) {
      data.farmStatus[interaction.user.id] = { confirm: false };
    }

    if (data.farmStatus[interaction.user.id].confirm) {
      return interaction.reply({
        content: "⚠️ คุณกดยืนยันไปแล้ว",
        flags: 64
      });
    }

    data.farmStatus[interaction.user.id].confirm = true;

    saveData(data);

    const embed = buildEmbed(data);

    await interaction.update({
      embeds: [embed],
      components: interaction.message.components
    });

    const [a, b] = data.currentPair;

    if (
      data.farmStatus[a]?.confirm &&
      data.farmStatus[b]?.confirm
    ) {

      await interaction.followUp({
        content: "🎉 ยืนยันฟาร์มครบแล้ว!"
      });

    }

  }

});

client.once("ready", () => {
  console.log("Farm bot ready");
});

client.login(TOKEN);
