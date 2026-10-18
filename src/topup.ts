import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from "discord.js";
import { config } from "./config.js";

interface ActiveSession {
  timer: NodeJS.Timeout;
  intentId: string;
}
const activeSessions = new Map<string, ActiveSession>();

export function clearActiveSession(userId: string) {
  const session = activeSessions.get(userId);
  if (session) {
    clearInterval(session.timer);
    activeSessions.delete(userId);
  }
}

/**
 * สร้าง Embed และปุ่มสำหรับ Topup Panel หน้าร้าน/ห้องเติมเงิน
 */
export function buildTopupPanel() {
  const embed = new EmbedBuilder()
    .setTitle("☁️ Figura Cloud · เติมเงินอัตโนมัติ")
    .setColor(0x00b4d8)
    .setDescription(
      "เติมเงินและต่ออายุแพ็กเกจ Figura Cloud สะดวกรวดเร็ว ตลอด 24 ชม.\n\n" +
      "### ⚡ ระบบชำระเงินอัตโนมัติ (Stripe PromptPay)\n" +
      "> • **สแกน QR Code พร้อมเพย์** ผ่านแอปธนาคารใดก็ได้\n" +
      "> • **ตรวจจับยอดเงินอัตโนมัติ** ภายใน 1-3 วินาที\n" +
      "> • **ไม่ต้องส่งสลิปหรือแนบรูปภาพ** ยอดเงินเข้ากระเป๋าทันที\n\n" +
      "### 🏷️ แพ็กเกจ Server Tier\n" +
      `> • **ราคา:** ${config.figura.serverMonthlyPrice} บาท / 30 วัน\n` +
      "> • **คุณสมบัติ:** ปลดล็อกให้เซิร์ฟเวอร์ใช้งานโมเดล Figura ได้สูงสุด 30 MB\n" +
      "> • **ระบบ:** ต่ออายุอัตโนมัติเมื่อครบกำหนด (หักจากกระเป๋าเงิน)\n\n" +
      "### 📲 วิธีการเติมเงิน\n" +
      "> 1. กดปุ่ม **เติมเงิน** ด้านล่าง แล้วพิมพ์จำนวนเงิน (เช่น 50, 100)\n" +
      "> 2. สแกน QR Code เพื่อชำระเงินผ่านแอปธนาคาร\n" +
      "> 3. ระบบจะปรับยอดเงินและอัปเดตแพ็กเกจให้อัตโนมัติทันที!"
    )
    .setFooter({
      text: "Figura-SIRU · ระบบชำระเงิน PromptPay อัตโนมัติ (Stripe)",
    });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("topup_start")
      .setLabel("เติมเงิน")
      .setStyle(ButtonStyle.Success)
      .setEmoji("💳"),
    new ButtonBuilder()
      .setCustomId("topup_check_balance")
      .setLabel("เช็คยอดเงิน")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("💰"),
    new ButtonBuilder()
      .setCustomId("topup_help")
      .setLabel("คำแนะนำ")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("❓")
  );

  return { embeds: [embed], components: [row] };
}

/**
 * จัดการคำสั่ง /topup-panel (เฉพาะ Admin)
 */
export async function handleTopupPanelCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const member = interaction.member as GuildMember | null;
  const isAdmin =
    member?.permissions.has(PermissionFlagsBits.Administrator) ||
    (config.discord.adminRoleId && member?.roles.cache.has(config.discord.adminRoleId));

  if (!isAdmin) {
    await interaction.reply({
      content: "⚠️ คุณไม่มีสิทธิ์ใช้งานคำสั่งนี้ (เฉพาะแอดมิน)",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.channel;
  if (!channel || !("send" in channel)) {
    await interaction.reply({
      content: "⚠️ ไม่สามารถส่งข้อความในห้องนี้ได้",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const panel = buildTopupPanel();
  await channel.send(panel);

  await interaction.reply({
    content: "✅ ติดตั้งกล่องเติมเงิน (Topup Panel) เรียบร้อยแล้ว!",
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * จัดการคำสั่ง /topup [amount]
 */
export async function handleTopupCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const amount = interaction.options.getNumber("amount") || 50;

  if (amount < 1) {
    await interaction.reply({
      content: "⚠️ ยอดเติมเงินขั้นต่ำคือ 1 บาท",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await initiateStripeTopup(interaction, amount);
}

/**
 * จัดการเมื่อมีการกดปุ่มใน Topup Panel
 */
export async function handleTopupButton(interaction: ButtonInteraction): Promise<void> {
  const { customId } = interaction;

  // 1. กดปุ่ม "เติมเงิน" -> แสดง Modal ให้กรอกจำนวนเงิน
  if (customId === "topup_start") {
    clearActiveSession(interaction.user.id);

    const modal = new ModalBuilder()
      .setCustomId("topup_amount_modal")
      .setTitle("เติมเงิน Figura Cloud");

    const amountInput = new TextInputBuilder()
      .setCustomId("amount")
      .setLabel("จำนวนเงินที่ต้องการเติม (บาท)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("เช่น 50, 100, 150")
      .setValue("50")
      .setMinLength(1)
      .setMaxLength(6)
      .setRequired(true);

    const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);
    return;
  }

  // 2. กดปุ่ม "เช็คยอดเงิน"
  if (customId === "topup_check_balance") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await showSubscriberBalance(interaction);
    return;
  }

  // 3. กดปุ่ม "คำแนะนำ"
  if (customId === "topup_help") {
    const helpEmbed = new EmbedBuilder()
      .setTitle("❓ แนะนำบริการ Figura Cloud และระบบเติมเงิน")
      .setColor(0x00b4d8)
      .setDescription(
        "บริการคลาวด์เชื่อมต่อ Avatar และ Model สำหรับเซิร์ฟเวอร์ Minecraft\n" +
        "────────────────────────────────────\n\n" +
        "### 📦 สิทธิ์ประโยชน์ Server Tier (50฿ / 30 วัน)\n" +
        "> • รองรับไฟล์โมเดลขนาดใหญ่สูงสุด **30 MB**\n" +
        "> • ผู้เล่นในเซิร์ฟเวอร์มองเห็น Avatar และแอนิเมชันได้ทันที\n" +
        "> • เติมเงินสะสมไว้ได้ ระบบจะตัดรอบต่ออายุให้อัตโนมัติ\n\n" +
        "### ⚡ ระบบชำระเงินรูปแบบใหม่ (PromptPay อัตโนมัติ)\n" +
        "> 1. กดปุ่ม 「 💳 เติมเงิน 」 หรือพิมพ์ `/topup` แล้วระบุยอดเงิน\n" +
        "> 2. สแกน QR Code ที่ระบบสร้างให้ผ่านแอปธนาคารใดก็ได้\n" +
        "> 3. **ไม่ต้องส่งสลิป!** ระบบตรวจจับยอดเงินและปรับเข้ากระเป๋าให้อัตโนมัติทันทีใน 1-3 วินาที\n\n" +
        "💬 หากพบปัญหา สามารถเปิด Ticket แจ้งทีมงานได้ตลอดเวลาครับ"
      );

    await interaction.reply({ embeds: [helpEmbed], flags: MessageFlags.Ephemeral });
    return;
  }

  // 4. กดปุ่ม "ตรวจสอบยอดทันที"
  if (customId.startsWith("topup_check_now:")) {
    const intentId = customId.split(":")[1];
    await interaction.deferUpdate();
    await checkStripeStatusOnce(interaction, intentId);
    return;
  }

  // 5. กดปุ่ม "ยกเลิกรายการ"
  if (customId.startsWith("topup_cancel:")) {
    const intentId = customId.split(":")[1];
    clearActiveSession(interaction.user.id);

    const cancelEmbed = new EmbedBuilder()
      .setTitle("❌ รายการชำระเงินถูกยกเลิกแล้ว")
      .setDescription("คุณได้ยกเลิกรายการนี้เรียบร้อยแล้ว หากต้องการเติมเงินใหม่กรุณากดปุ่มด้านล่าง")
      .setColor(0x95a5a6);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("topup_start")
        .setLabel("สร้างรายการใหม่")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🔄")
    );

    await interaction.update({
      embeds: [cancelEmbed],
      components: [row],
    }).catch(() => {});

    try {
      await fetch(`${config.figura.apiUrl}/api/bot/stripe/cancel/${intentId}`, {
        method: "POST",
        headers: { "x-bot-token": config.discord.token },
      });
    } catch {}

    return;
  }
}

/**
 * จัดการเมื่อมีการ Submit Modal ระบุจำนวนเงิน
 */
export async function handleTopupModal(interaction: ModalSubmitInteraction): Promise<void> {
  const { customId } = interaction;

  if (customId === "topup_amount_modal") {
    const rawAmount = interaction.fields.getTextInputValue("amount").trim();
    const amount = parseFloat(rawAmount);

    if (isNaN(amount) || amount <= 0) {
      await interaction.reply({
        content: "⚠️ กรุณาระบุจำนวนเงินเป็นตัวเลขที่ถูกต้อง (เช่น 50, 100)",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (amount < 1) {
      await interaction.reply({
        content: "⚠️ ยอดเติมเงินขั้นต่ำคือ 1 บาท",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await initiateStripeTopup(interaction, amount);
  }
}

/**
 * ฟังก์ชันสร้าง Stripe PromptPay QR Code และเริ่ม Polling อัตโนมัติ
 */
async function initiateStripeTopup(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  amount: number
): Promise<void> {
  clearActiveSession(interaction.user.id);

  try {
    // 1. เรียก Backend เพื่อสร้าง Stripe PaymentIntent
    const res = await fetch(`${config.figura.apiUrl}/api/bot/stripe/create-topup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bot-token": config.discord.token,
      },
      body: JSON.stringify({
        discord_id: interaction.user.id,
        discord_username: interaction.user.tag || interaction.user.username,
        amount,
      }),
    });

    const data = (await res.json().catch(() => null)) as any;

    if (!res.ok || !data?.success) {
      const errMsg =
        data?.error || data?.message || "ไม่สามารถสร้างรายการชำระเงินได้ กรุณาลองใหม่อีกครั้ง";
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌ เกิดข้อผิดพลาด")
            .setDescription(errMsg)
            .setColor(0xe74c3c),
        ],
      });
      return;
    }

    const { payment_intent_id, qr_image_url, hosted_url } = data;

    const totalSeconds = 10 * 60; // 10 minutes = 600s
    const endTime = Date.now() + totalSeconds * 1000;

    const buildQrDescription = (remainingSec: number) => {
      const mm = String(Math.floor(remainingSec / 60)).padStart(2, "0");
      const ss = String(remainingSec % 60).padStart(2, "0");
      return (
        `> 💵 **ยอดชำระ:**  \`${amount.toFixed(2)} บาท\`\n` +
        "> \n" +
        "> 🟢 **สถานะ:**  `รอการชำระเงิน (ระบบตรวจจับอัตโนมัติ)`\n" +
        "> \n" +
        `> ⏳ **เหลือเวลาชำระเงิน:**  \`${mm}:${ss}\` นาที\n\n` +
        "💡 **คำแนะนำ:** สแกน QR Code ผ่านแอปธนาคารใดก็ได้ เมื่อชำระเงินแล้วระบบจะปรับยอดให้ทันที **ไม่ต้องส่งสลิป**"
      );
    };

    const qrEmbed = new EmbedBuilder()
      .setTitle("📲 สแกน QR Code เพื่อชำระเงิน (Stripe PromptPay)")
      .setColor(0x00b4d8)
      .setDescription(buildQrDescription(totalSeconds))
      .setImage(qr_image_url)
      .setFooter({ text: `รหัสธุรกรรม: ${payment_intent_id}` });

    const components: any[] = [];
    const btnRow = new ActionRowBuilder<ButtonBuilder>();

    if (hosted_url) {
      btnRow.addComponents(
        new ButtonBuilder()
          .setLabel("เปิดหน้าเว็บ Stripe")
          .setStyle(ButtonStyle.Link)
          .setURL(hosted_url)
          .setEmoji("🌐")
      );
    }

    btnRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`topup_check_now:${payment_intent_id}`)
        .setLabel("ตรวจสอบยอดเงิน")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🔄"),
      new ButtonBuilder()
        .setCustomId(`topup_cancel:${payment_intent_id}`)
        .setLabel("ยกเลิก")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("❌")
    );

    components.push(btnRow);

    await interaction.editReply({
      embeds: [qrEmbed],
      components,
    });

    // 2. เริ่ม Polling ตรวจสอบสถานะการชำระเงินทุก 3 วินาที
    let lastRenderedSec = totalSeconds;

    const timer = setInterval(async () => {
      const remainingSec = Math.max(0, Math.floor((endTime - Date.now()) / 1000));

      if (remainingSec <= 0) {
        clearActiveSession(interaction.user.id);

        try {
          await fetch(`${config.figura.apiUrl}/api/bot/stripe/cancel/${payment_intent_id}`, {
            method: "POST",
            headers: { "x-bot-token": config.discord.token },
          });
        } catch {}

        const expiredEmbed = new EmbedBuilder()
          .setTitle("⌛ QR Code หมดอายุแล้ว")
          .setColor(0x95a5a6)
          .setDescription(
            `> 💵 **ยอดชำระ:**  \`${amount.toFixed(2)} บาท\`\n` +
            "> \n" +
            "> ❌ **หมดเวลาชำระเงินแล้ว** (เกิน 10 นาที)\n\n" +
            "กรุณากดปุ่มด้านล่างเพื่อสร้าง QR Code ใหม่ครับ"
          );

        const expiredRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("topup_start")
            .setLabel("สร้าง QR Code ใหม่")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("🔄")
        );

        await interaction.editReply({
          embeds: [expiredEmbed],
          components: [expiredRow],
        }).catch(() => {
          clearActiveSession(interaction.user.id);
        });
        return;
      }

      // Check Stripe payment status
      try {
        const checkRes = await fetch(
          `${config.figura.apiUrl}/api/bot/stripe/check/${payment_intent_id}`,
          {
            headers: { "x-bot-token": config.discord.token },
          }
        );

        const checkData = (await checkRes.json().catch(() => null)) as any;

        if (checkRes.ok && checkData?.status === "succeeded") {
          clearActiveSession(interaction.user.id);
          await handlePaymentSuccess(interaction, checkData, payment_intent_id);
          return;
        }

        if (checkData?.status === "canceled") {
          clearActiveSession(interaction.user.id);
          const cancelEmbed = new EmbedBuilder()
            .setTitle("❌ รายการชำระเงินถูกยกเลิกแล้ว")
            .setDescription("รายการชำระเงินนี้ถูกยกเลิกในระบบแล้ว")
            .setColor(0x95a5a6);
          await interaction.editReply({ embeds: [cancelEmbed], components: [] }).catch(() => {});
          return;
        }
      } catch (err) {
        console.warn("[topup] polling error:", (err as Error).message);
      }

      // อัปเดตเวลานับถอยหลังทุก 15 วินาที เพื่อประหยัด Discord Rate Limit
      const shouldUpdateDesc = (lastRenderedSec - remainingSec) >= 15;
      if (shouldUpdateDesc) {
        lastRenderedSec = remainingSec;
        const updatedEmbed = new EmbedBuilder()
          .setTitle("📲 สแกน QR Code เพื่อชำระเงิน (Stripe PromptPay)")
          .setColor(0x00b4d8)
          .setDescription(buildQrDescription(remainingSec))
          .setImage(qr_image_url)
          .setFooter({ text: `รหัสธุรกรรม: ${payment_intent_id}` });

        await interaction.editReply({
          embeds: [updatedEmbed],
          components,
        }).catch(() => {
          clearActiveSession(interaction.user.id);
        });
      }
    }, 3000);

    activeSessions.set(interaction.user.id, { timer, intentId: payment_intent_id });
  } catch (err) {
    console.error("[topup] initiateStripeTopup error:", err);
    await interaction.editReply({
      content: `⚠️ เกิดข้อผิดพลาด: ${(err as Error).message}`,
    });
  }
}

/**
 * ฟังก์ชันตรวจสอบสถานะเมื่อผู้ใช้กดปุ่ม 'ตรวจสอบยอดเงิน'
 */
async function checkStripeStatusOnce(
  interaction: ButtonInteraction,
  intentId: string
): Promise<void> {
  try {
    const res = await fetch(`${config.figura.apiUrl}/api/bot/stripe/check/${intentId}`, {
      headers: { "x-bot-token": config.discord.token },
    });
    const data = (await res.json().catch(() => null)) as any;

    if (res.ok && data?.status === "succeeded") {
      clearActiveSession(interaction.user.id);
      await handlePaymentSuccess(interaction, data, intentId);
      return;
    }

    if (data?.status === "canceled") {
      clearActiveSession(interaction.user.id);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌ รายการถูกยกเลิกแล้ว")
            .setDescription("รายการนี้ถูกยกเลิกแล้ว ไม่สามารถดำเนินการต่อได้")
            .setColor(0x95a5a6),
        ],
        components: [],
      });
      return;
    }

    // ยังไม่สำเร็จ
    await interaction.followUp({
      content: "⏳ ยังไม่พบยอดเงินในระบบ กรุณารอ 2-3 วินาทีหลังจากสแกนจ่ายแล้วกดตรวจสอบอีกครั้งครับ",
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    await interaction.followUp({
      content: `⚠️ ตรวจสอบไม่สำเร็จ: ${(err as Error).message}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

function formatPackageTier(tierRaw: any, expiresAtRaw: any, projectName?: any): string {
  const t = String(tierRaw || "").toLowerCase();
  if (t === "server") return "SERVER";
  if (t === "personal") return "PERSONAL";
  if (projectName && expiresAtRaw) return "SERVER";
  return "PERSONAL";
}

/**
 * จัดการเมื่อการชำระเงินสำเร็จ (สร้างใบเสร็จ, ให้ Role, ส่ง Admin notice)
 */
async function handlePaymentSuccess(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction | ButtonInteraction,
  data: any,
  intentId: string
): Promise<void> {
  const amount = Number(data.amount ?? 0);
  const newBalance = Number(data.balance ?? data.new_balance ?? 0);
  const autoRenewed = Boolean(data.auto_renewed);
  const expiresAt = data.expires_at;
  const projectName = data.project_name;
  const tier = formatPackageTier(data.tier, expiresAt, projectName);
  const subscriberUsername = data.username || interaction.user.username;

  const receiptFields: any[] = [
    {
      name: "ยอดเงินที่เติม",
      value: `+${amount.toFixed(2)} บาท`,
      inline: true,
    },
    {
      name: "ยอดคงเหลือในกระเป๋า",
      value: `฿${newBalance.toFixed(2)}`,
      inline: true,
    },
    {
      name: "แพ็กเกจ",
      value: `\`${tier}\``,
      inline: true,
    },
  ];

  if (projectName) {
    receiptFields.push({
      name: "โปรเจกต์",
      value: `\`${projectName}\``,
      inline: true,
    });
  }

  receiptFields.push(
    {
      name: "สถานะการต่ออายุ (Auto-Renew)",
      value: autoRenewed
        ? `🎉 ระบบหัก 50 บาท ต่ออายุ Server Tier ให้อัตโนมัติแล้ว\nวันหมดอายุใหม่: <t:${Math.floor(new Date(expiresAt).getTime() / 1000)}:f>`
        : "บันทึกเข้ากระเป๋าเรียบร้อย (ระบบจะต่ออายุอัตโนมัติเมื่อครบกำหนด)",
      inline: false,
    },
    {
      name: "รหัสอ้างอิงธุรกรรม",
      value: `\`${intentId}\``,
      inline: false,
    }
  );

  const receiptEmbed = new EmbedBuilder()
    .setTitle("✅ ชำระเงินสำเร็จ (Stripe PromptPay)")
    .setColor(0x2ecc71)
    .setDescription("ขอบคุณที่ใช้บริการ Figura Cloud! ยอดเงินเข้ากระเป๋าเรียบร้อยแล้ว")
    .addFields(receiptFields)
    .setFooter({ text: `บัญชี: ${subscriberUsername} · ยืนยันผ่าน Stripe` })
    .setTimestamp();

  await interaction.editReply({
    embeds: [receiptEmbed],
    components: [],
  });

  // ให้ Role Server Tier ใน Discord หากผู้ใช้ใช้แพ็กเกจ Server
  try {
    const member = interaction.member as GuildMember | null;
    const isServerTier = String(tier).toLowerCase() === "server" || autoRenewed;
    if (
      member &&
      isServerTier &&
      config.figura.roleId &&
      member.guild.roles.cache.has(config.figura.roleId) &&
      !member.roles.cache.has(config.figura.roleId)
    ) {
      await member.roles.add(config.figura.roleId, "Figura Server subscriber via Stripe PromptPay");
    }
  } catch (roleErr) {
    console.warn("[topup] failed to assign role:", (roleErr as Error).message);
  }

  // แจ้งเตือนห้อง Admin Slip/Topup Log Channel
  const eventChannelId =
    config.figura.topupNoticeChannelId ||
    config.discord.eventChannelId ||
    config.discord.alertChannelId;

  if (eventChannelId) {
    try {
      const channel =
        interaction.client.channels.cache.get(eventChannelId) ||
        (await interaction.client.channels.fetch(eventChannelId).catch(() => null));
      if (channel && channel.isTextBased() && "send" in channel) {
        const adminNotice = new EmbedBuilder()
          .setTitle("💳 การเติมเงินสำเร็จ (Stripe PromptPay)")
          .setDescription(
            `ผู้ใช้ <@${interaction.user.id}> (\`${interaction.user.tag}\`) เติมเงินผ่าน Stripe เรียบร้อยแล้ว`
          )
          .setColor(0x10b981)
          .addFields(
            { name: "ยอดเงินที่เติม", value: `+${amount.toFixed(2)} ฿`, inline: true },
            { name: "ยอดคงเหลือ", value: `${newBalance.toFixed(2)} ฿`, inline: true },
            { name: "แพ็กเกจ", value: `\`${tier.toUpperCase()}\``, inline: true },
            { name: "โปรเจกต์", value: projectName ? `\`${projectName}\`` : "—", inline: true },
            { name: "บัญชีผู้ใช้", value: subscriberUsername ? `\`${subscriberUsername}\`` : "—", inline: true },
            { name: "Auto-Renew", value: autoRenewed ? "✅ ต่ออายุแล้ว" : "—", inline: true },
            { name: "รหัสธุรกรรม Stripe", value: `\`${intentId}\``, inline: false }
          )
          .setTimestamp();

        await (channel as TextChannel).send({ embeds: [adminNotice] });
      }
    } catch (logErr) {
      console.warn("[topup] failed to send admin event notice:", (logErr as Error).message);
    }
  }
}

/**
 * ดึงและแสดงยอดคงเหลือในกระเป๋า
 */
async function showSubscriberBalance(
  interaction: ButtonInteraction
): Promise<void> {
  try {
    const res = await fetch(
      `${config.figura.apiUrl}/api/bot/subscriber/${interaction.user.id}`,
      {
        headers: { "x-bot-token": config.discord.token },
      }
    );

    const data = (await res.json().catch(() => null)) as any;

    if (!res.ok || !data?.found) {
      await interaction.editReply({
        content:
          "ℹ️ ยังไม่พบกระเป๋าเงินของคุณในระบบ\n" +
          "เมื่อคุณเติมเงินครั้งแรก ระบบจะเปิดบัญชีกระเป๋าเงินให้อัตโนมัติทันทีครับ",
      });
      return;
    }

    const balance = Number(data.balance || 0).toFixed(2);
    const projectName = data.project_name;
    const tier = formatPackageTier(data.tier, data.expires_at, projectName);
    const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
    const isExpired = expiresAt ? expiresAt.getTime() < Date.now() : true;

    const fields: any[] = [
      {
        name: "ยอดเงินคงเหลือ",
        value: `**฿${balance}**`,
        inline: true,
      },
      {
        name: "แพ็กเกจ",
        value: `\`${tier}\``,
        inline: true,
      },
    ];

    if (projectName) {
      fields.push({
        name: "โปรเจกต์",
        value: `\`${projectName}\``,
        inline: true,
      });
    }

    fields.push({
      name: "วันหมดอายุ",
      value: expiresAt
        ? `<t:${Math.floor(expiresAt.getTime() / 1000)}:f> (${isExpired ? "⛔ หมดอายุแล้ว" : `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`})`
        : (tier === "PERSONAL" ? "ฟรีตลอดชีพ" : "ยังไม่ได้เปิดใช้งานแพ็กเกจ"),
      inline: false,
    });

    const balanceEmbed = new EmbedBuilder()
      .setTitle(`💳 กระเป๋าเงิน: ${interaction.user.username}`)
      .setColor(0x00b4d8)
      .addFields(fields)
      .setFooter({ text: "หากยอดเงินคงเหลือ >= 50 บาท ระบบจะต่ออายุให้อัตโนมัติเมื่อหมดรอบ" })
      .setTimestamp();

    await interaction.editReply({ embeds: [balanceEmbed] });
  } catch (err) {
    await interaction.editReply({
      content: `⚠️ เกิดข้อผิดพลาดในการตรวจสอบยอดเงิน: ${(err as Error).message}`,
    });
  }
}
