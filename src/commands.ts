import { SlashCommandBuilder } from "discord.js";

// นิยาม slash commands ทั้งหมดไว้ที่เดียว ใช้ทั้งตอน deploy และตอน handle
export const commands = [
  new SlashCommandBuilder()
    .setName("sponsor-apply")
    .setDescription("สมัครขอเป็น Sponsor — bot จะตรวจเงื่อนไขก่อนส่งให้แอดมินอนุมัติ (D)")
    .addStringOption((opt) =>
      opt
        .setName("server")
        .setDescription("ชื่อ server หรือ Server ID ที่ต้องการขอ sponsor")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("serverstatus")
    .setDescription("ดูสถานะ server แบบสด: online/offline, plan, วันหมดอายุ, ผู้เล่นออนไลน์ (A)")
    .addStringOption((opt) =>
      opt.setName("server").setDescription("ชื่อ server หรือ Server ID").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("topup")
    .setDescription("เติมเงินกระเป๋า Figura-SIRU ด้วย PromptPay อัตโนมัติ (Stripe)")
    .addNumberOption((opt) =>
      opt
        .setName("amount")
        .setDescription("จำนวนเงินที่ต้องการเติม (บาท) เช่น 50, 100 (เว้นว่าง = 50)")
        .setMinValue(1)
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("topup-panel")
    .setDescription("ติดตั้งกล่องเติมเงิน Topup Panel ในช่องนี้ (เฉพาะ Admin)"),

  new SlashCommandBuilder()
    .setName("nodestatus")
    .setDescription("ดูสถานะ Node 1 / Node 2 และ Region ที่กำลังให้บริการแบบสดๆ (Cluster Status)"),
].map((c) => c.toJSON());
