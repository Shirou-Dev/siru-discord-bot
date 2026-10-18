import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";
import { config } from "./config.js";
import { countOnlinePlayers, findServers, ServerRow, updateServerSponsor } from "./db.js";
import {
  addSponsorApp,
  getSponsorApp,
  hasPendingAppForServer,
  updateSponsorAppStatus,
} from "./store.js";

const DAY_MS = 86_400_000;

interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

function ageDays(date: Date | null): number {
  if (!date) return 0;
  return (Date.now() - new Date(date).getTime()) / DAY_MS;
}

function heartbeatFresh(server: ServerRow): boolean {
  if (!server.lastHeartbeat) return false;
  return Date.now() - new Date(server.lastHeartbeat).getTime() <= 6 * 60 * 1000;
}

/** /sponsor-apply server:<name|id> */
export async function handleSponsorApply(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const query = interaction.options.getString("server", true).trim();
  const member = interaction.member as GuildMember | null;
  if (!member) {
    await interaction.editReply("ใช้คำสั่งนี้ได้เฉพาะใน Discord server เท่านั้น");
    return;
  }

  // หา server
  let matches: ServerRow[];
  try {
    matches = await findServers(query);
  } catch (err) {
    await interaction.editReply(`เชื่อมต่อฐานข้อมูลไม่ได้: ${(err as Error).message}`);
    return;
  }

  if (matches.length === 0) {
    await interaction.editReply(`ไม่พบ server ชื่อหรือ ID: \`${query}\``);
    return;
  }
  if (matches.length > 1) {
    const ids = matches.map((s) => `\`${s.id}\``).join(", ");
    await interaction.editReply(`พบ server ชื่อซ้ำ ${matches.length} ตัว กรุณาใช้ Server ID แทน: ${ids}`);
    return;
  }

  const server = matches[0];

  if (server.isSponsored) {
    await interaction.editReply(`server **${server.name}** เป็น sponsored อยู่แล้ว`);
    return;
  }
  if (hasPendingAppForServer(server.id)) {
    await interaction.editReply(`server **${server.name}** มีใบสมัคร sponsor ค้างรออนุมัติอยู่แล้ว`);
    return;
  }

  // ── เงื่อนไขที่ bot ตรวจอัตโนมัติ ──
  const online = await countOnlinePlayers(server.id).catch(() => 0);
  const memberDays = ageDays(member.joinedAt);
  const serverDays = ageDays(server.createdAt);

  const checks: Check[] = [
    {
      label: `เป็นสมาชิก Discord ≥ ${config.sponsor.minMemberDays} วัน`,
      ok: memberDays >= config.sponsor.minMemberDays,
      detail: `${Math.floor(memberDays)} วัน`,
    },
    {
      label: `server เปิดมา ≥ ${config.sponsor.minServerAgeDays} วัน`,
      ok: serverDays >= config.sponsor.minServerAgeDays,
      detail: `${Math.floor(serverDays)} วัน`,
    },
    {
      label: "server activated แล้ว",
      ok: server.isActive,
      detail: server.isActive ? "active" : "ยังไม่ activate (/siruskinverify)",
    },
    {
      label: "server ออนไลน์ (heartbeat ปกติ)",
      ok: heartbeatFresh(server),
      detail: heartbeatFresh(server) ? "ออนไลน์" : "ออฟไลน์",
    },
    {
      label: `ผู้เล่นออนไลน์ ≥ ${config.sponsor.minOnlinePlayers} คน`,
      ok: online >= config.sponsor.minOnlinePlayers,
      detail: `${online} คน`,
    },
  ];

  if (config.sponsor.requiredRoleId) {
    checks.push({
      label: `มี role ที่กำหนด (<@&${config.sponsor.requiredRoleId}>)`,
      ok: member.roles.cache.has(config.sponsor.requiredRoleId),
      detail: member.roles.cache.has(config.sponsor.requiredRoleId) ? "มี" : "ไม่มี",
    });
  }

  const allPass = checks.every((c) => c.ok);
  const checklist = checks.map((c) => `${c.ok ? "✅" : "❌"} ${c.label} — ${c.detail}`).join("\n");

  if (!allPass) {
    await interaction.editReply(
      `❌ ยังสมัคร sponsor ไม่ได้ — ไม่ผ่านเงื่อนไขบางข้อ:\n\n${checklist}`
    );
    return;
  }

  // ── ผ่านทุกข้อ → ส่งใบสมัครเข้า channel รีวิวของแอดมิน ──
  const reviewChannel = await fetchTextChannel(interaction, config.discord.sponsorReviewChannelId);
  if (!reviewChannel) {
    await interaction.editReply("ตั้งค่า SPONSOR_REVIEW_CHANNEL_ID ไม่ถูกต้อง ติดต่อแอดมิน");
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("📨 ใบสมัคร Sponsor")
    .setColor(0x9b59b6)
    .addFields(
      { name: "ผู้สมัคร", value: `<@${member.id}>`, inline: true },
      { name: "Server", value: server.name, inline: true },
      { name: "Plan", value: server.plan, inline: true },
      { name: "Server ID", value: `\`${server.id}\``, inline: false },
      { name: "ผลตรวจอัตโนมัติ", value: checklist, inline: false }
    )
    .setFooter({ text: "รออนุมัติ" })
    .setTimestamp(new Date());

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("sponsor_approve").setLabel("อนุมัติ").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("sponsor_reject").setLabel("ปฏิเสธ").setStyle(ButtonStyle.Danger)
  );

  const msg = await reviewChannel.send({ embeds: [embed], components: [row] });

  addSponsorApp(msg.id, {
    serverId: server.id,
    serverName: server.name,
    applicantId: member.id,
    status: "PENDING",
    createdAt: new Date().toISOString(),
  });

  await interaction.editReply(
    `✅ ส่งใบสมัคร sponsor ของ **${server.name}** แล้ว ผ่านการตรวจอัตโนมัติครบ รอแอดมินอนุมัติ\n\n${checklist}`
  );
}

/** กดปุ่ม อนุมัติ/ปฏิเสธ บนใบสมัคร */
export async function handleSponsorButton(interaction: ButtonInteraction): Promise<void> {
  const member = interaction.member as GuildMember | null;
  const isAdmin =
    !!member &&
    (member.roles.cache.has(config.discord.adminRoleId) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) === true);

  if (!isAdmin) {
    await interaction.reply({ content: "เฉพาะแอดมินเท่านั้นที่กดได้", ephemeral: true });
    return;
  }

  const app = getSponsorApp(interaction.message.id);
  if (!app) {
    await interaction.reply({ content: "ไม่พบใบสมัครนี้ (อาจเก่าเกินไป)", ephemeral: true });
    return;
  }
  if (app.status !== "PENDING") {
    await interaction.reply({ content: `ใบสมัครนี้ถูก${app.status === "APPROVED" ? "อนุมัติ" : "ปฏิเสธ"}ไปแล้ว`, ephemeral: true });
    return;
  }

  const approve = interaction.customId === "sponsor_approve";
  await interaction.deferUpdate();

  const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("sponsor_approve").setLabel("อนุมัติ").setStyle(ButtonStyle.Success).setDisabled(true),
    new ButtonBuilder().setCustomId("sponsor_reject").setLabel("ปฏิเสธ").setStyle(ButtonStyle.Danger).setDisabled(true)
  );

  const baseEmbed = EmbedBuilder.from(interaction.message.embeds[0]);

  if (!approve) {
    updateSponsorAppStatus(interaction.message.id, "REJECTED");
    baseEmbed.setColor(0xe74c3c).setFooter({ text: `ปฏิเสธโดย ${interaction.user.tag}` });
    await interaction.message.edit({ embeds: [baseEmbed], components: [disabledRow] });
    await notifyApplicant(interaction, app.applicantId, `❌ ใบสมัคร sponsor ของ **${app.serverName}** ถูกปฏิเสธ`);
    return;
  }

  // อนุมัติ → อัปเดต server ในฐานข้อมูล
  const matches = await findServers(app.serverId).catch(() => [] as ServerRow[]);
  const server = matches[0];
  if (!server) {
    await interaction.followUp({ content: "หา server ในฐานข้อมูลไม่เจอแล้ว (อาจถูกลบ)", ephemeral: true });
    return;
  }

  const base = new Date(server.expiresAt).getTime() > Date.now() ? new Date(server.expiresAt) : new Date();
  const newExpiry = new Date(base.getTime() + config.sponsor.grantDays * DAY_MS);
  const note = `Sponsored via Discord by ${interaction.user.tag} on ${new Date().toISOString().slice(0, 10)}`;

  try {
    await updateServerSponsor(server.id, { note, expiresAt: newExpiry });
  } catch (err) {
    await interaction.followUp({ content: `อัปเดตฐานข้อมูลล้มเหลว: ${(err as Error).message}`, ephemeral: true });
    return;
  }

  updateSponsorAppStatus(interaction.message.id, "APPROVED");

  // ให้ role sponsor
  try {
    const applicant = await interaction.guild!.members.fetch(app.applicantId);
    await applicant.roles.add(config.discord.sponsorRoleId);
  } catch (err) {
    await interaction.followUp({
      content: `อนุมัติแล้วแต่ให้ role ไม่สำเร็จ (เช็คสิทธิ์ bot / ลำดับ role): ${(err as Error).message}`,
      ephemeral: true,
    });
  }

  baseEmbed
    .setColor(0x2ecc71)
    .setFooter({ text: `อนุมัติโดย ${interaction.user.tag} • หมดอายุใหม่ ${newExpiry.toISOString().slice(0, 10)}` });
  await interaction.message.edit({ embeds: [baseEmbed], components: [disabledRow] });

  await notifyApplicant(
    interaction,
    app.applicantId,
    `🎉 ใบสมัคร sponsor ของ **${app.serverName}** ได้รับอนุมัติแล้ว! ขยายอายุถึง <t:${Math.floor(newExpiry.getTime() / 1000)}:f>`
  );

  // ประกาศใน channel sponsor (ถ้าตั้งค่าไว้)
  if (config.discord.sponsorAnnounceChannelId) {
    const ch = await fetchTextChannel(interaction, config.discord.sponsorAnnounceChannelId);
    await ch?.send(`🤝 ยินดีต้อนรับ sponsor ใหม่: **${app.serverName}** (<@${app.applicantId}>)`).catch(() => {});
  }
}

async function notifyApplicant(
  interaction: ButtonInteraction,
  applicantId: string,
  message: string
): Promise<void> {
  try {
    const user = await interaction.client.users.fetch(applicantId);
    await user.send(message);
  } catch {
    // DM ปิดอยู่ → แจ้งในห้องรีวิวแทน
    await interaction.followUp({ content: `<@${applicantId}> ${message}`, ephemeral: false }).catch(() => {});
  }
}

async function fetchTextChannel(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  id: string
): Promise<TextChannel | null> {
  try {
    const ch = await interaction.client.channels.fetch(id);
    if (ch && ch.isTextBased()) return ch as TextChannel;
  } catch {
    /* ignore */
  }
  return null;
}
