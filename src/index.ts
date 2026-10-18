import {
  Client,
  GatewayIntentBits,
  Interaction,
  ChatInputCommandInteraction,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} from "discord.js";
import { config } from "./config.js";
import { loadState } from "./store.js";
import { startMonitor } from "./monitor.js";
import { handleSponsorApply, handleSponsorButton } from "./sponsor.js";
import {
  handleTopupCommand,
  handleTopupButton,
  handleTopupPanelCommand,
  handleTopupModal,
} from "./topup.js";
import { deployCommands } from "./deploy-commands.js";
import { countOnlinePlayers, findServers, pingDb, ServerRow } from "./db.js";
import { buildNodeStatusContainer, getClusterNodesStatus } from "./service.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once("ready", async () => {
  console.log(`[bot] logged in as ${client.user?.tag}`);

  const dbOk = await pingDb();
  console.log(`[bot] database: ${dbOk ? "connected" : "UNREACHABLE"}`);

  if (process.env.DEPLOY_COMMANDS === "true") {
    try {
      await deployCommands();
    } catch (err) {
      console.error("[bot] deploy commands failed:", (err as Error).message);
    }
  }

  startMonitor(client);
});

client.on("interactionCreate", async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "sponsor-apply") {
        await handleSponsorApply(interaction);
      } else if (interaction.commandName === "serverstatus") {
        await handleServerStatus(interaction);
      } else if (interaction.commandName === "nodestatus") {
        await handleNodeStatusCommand(interaction);
      } else if (interaction.commandName === "topup") {
        await handleTopupCommand(interaction);
      } else if (interaction.commandName === "topup-panel") {
        await handleTopupPanelCommand(interaction);
      }
    } else if (interaction.isButton()) {
      if (interaction.customId.startsWith("sponsor_")) {
        await handleSponsorButton(interaction);
      } else if (interaction.customId.startsWith("topup_")) {
        await handleTopupButton(interaction);
      }
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("topup_")) {
        await handleTopupModal(interaction);
      }
    }
  } catch (err) {
    console.error("[bot] interaction error:", (err as Error).message);
    if (interaction.isRepliable()) {
      const msg = "เกิดข้อผิดพลาดภายใน ลองใหม่อีกครั้ง";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg).catch(() => {});
      } else {
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    }
  }
});

// container ข้อความง่ายๆ (ใช้ตอบ error แบบ V2 ให้ตรงสไตล์)
function simpleContainer(text: string, color = 0x95a5a6): ContainerBuilder {
  return new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}

// /serverstatus — ดึงสถานะสดของ server (A, แบบ on-demand)
async function handleServerStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  // ตอบตรงๆ พร้อม flag V2 ตั้งแต่แรก — deferReply ไม่ติด flag IsComponentsV2 (จะ error)
  const reply = (container: ContainerBuilder) =>
    interaction.reply({
      components: [container],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
  const query = interaction.options.getString("server", true).trim();

  let matches: ServerRow[];
  try {
    matches = await findServers(query);
  } catch (err) {
    await reply(simpleContainer(`⚠️ เชื่อมต่อฐานข้อมูลไม่ได้: ${(err as Error).message}`, 0xe74c3c));
    return;
  }

  if (matches.length === 0) {
    await reply(simpleContainer(`ไม่พบ server: \`${query}\``));
    return;
  }
  if (matches.length > 1) {
    await reply(
      simpleContainer(`พบชื่อซ้ำ ${matches.length} ตัว ใช้ Server ID:\n${matches.map((s) => `\`${s.id}\``).join("\n")}`)
    );
    return;
  }

  const s = matches[0];
  const online = await countOnlinePlayers(s.id).catch(() => 0);
  const hbAgeMin = s.lastHeartbeat
    ? (Date.now() - new Date(s.lastHeartbeat).getTime()) / 60000
    : Infinity;
  const isOnline = hbAgeMin <= config.monitor.offlineAfterMinutes;
  const expired = new Date(s.expiresAt).getTime() < Date.now();
  const epoch = (d: Date) => Math.floor(new Date(d).getTime() / 1000);

  const statusText = expired ? "⛔ หมดอายุ" : isOnline ? "🟢 ออนไลน์" : "🔴 ออฟไลน์";
  const accent = expired ? 0x95a5a6 : isOnline ? 0x2ecc71 : 0xe74c3c;

  const lines = [
    `**สถานะ:** ${statusText}   ·   **Plan:** \`${s.plan}\``,
    `**Activated:** ${s.isActive ? "✅" : "🟡 ยังไม่ activate"}   ·   **ผู้เล่นออนไลน์:** ${online} คน`,
    `**Sponsored:** ${s.isSponsored ? "🤝 ใช่" : "—"}   ·   **Auto-renew:** ${s.autoRenew ? "เปิด" : "ปิด"}`,
    `**heartbeat ล่าสุด:** ${s.lastHeartbeat ? `<t:${epoch(s.lastHeartbeat)}:R>` : "ไม่เคย"}`,
    `**หมดอายุ:** <t:${epoch(s.expiresAt)}:f>`,
  ];

  const container = new ContainerBuilder()
    .setAccentColor(accent)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 📊 สถานะ: ${s.name}`))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Server ID: \`${s.id}\``));

  await reply(container);
}

async function handleNodeStatusCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const cluster = await getClusterNodesStatus();
  const container = buildNodeStatusContainer(cluster.active, cluster.node1, cluster.node2, cluster.lastSync);

  await interaction.editReply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}

loadState();
client.login(config.discord.token).catch((err) => {
  console.error("[bot] login failed:", err.message);
  process.exit(1);
});
