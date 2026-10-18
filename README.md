# SIRU-SKIN Discord Bot

Bot Discord สำหรับระบบ SIRU-SKIN — ทำ **2 ระบบ**:

- **A. Monitoring & Alerts** — สแกน server ตามรอบ (UI แบบ **Components V2**)
  - 📊 **Dashboard เดียว** (pin ไว้) แสดง online/offline ทุกเซิร์ฟ — edit ข้อความเดิมทุกรอบ → ช่อง **สาธารณะ** (`ALERT_CHANNEL_ID`)
  - ✅ activate / 🛡️ IP เปลี่ยน / ⏰ ใกล้หมดอายุ — โพสต์แยกไปช่อง **แอดมิน** (`EVENT_CHANNEL_ID`)
  - `/serverstatus <server>` — ดูสถานะสด on-demand (ephemeral)
  - 🛰️ **Service Status panel (SIRU-SKIN)** — แยกอีกข้อความ (pin): API/Database/uptime/maintenance + PM2 clusters + incidents ล่าสุด
  - 🎭 **Service Status panel (SIRU-FiguraCloud)** — แยกอีกข้อความ (pin): API/Database + ออนไลน์/whitelist/version (ดึงจาก Rust API port 3011)
- **D. Sponsor Verification** — `/sponsor-apply <server>` ให้ bot ตรวจเงื่อนไขอัตโนมัติ
  ก่อนส่งใบสมัครให้แอดมินกดอนุมัติ/ปฏิเสธ → อนุมัติแล้ว bot อัปเดต DB + ให้ role

> **สำคัญ:** bot นี้ **standalone** ต่อ Postgres ตัวเดียวกับ backend
> อ่านข้อมูลเป็นหลัก เขียนเฉพาะตอนอนุมัติ sponsor (`UPDATE "Server"`)
> **ไม่แตะไฟล์ backend และไม่แก้ schema** — ใบสมัคร sponsor เก็บใน `data/state.json` ของ bot เอง

## ติดตั้ง

```bash
cd siru-skin-discord-bot
npm install
cp .env.example .env   # แล้วแก้ค่าใน .env
npm run dev            # หรือ npm start
```

## ตั้งค่า .env

| ตัวแปร | ความหมาย |
|--------|----------|
| `DISCORD_TOKEN` / `DISCORD_CLIENT_ID` / `GUILD_ID` | จาก Discord Developer Portal |
| `ALERT_CHANNEL_ID` | channel โชว์ **Dashboard** (A) — สาธารณะ ทุกคนเห็น |
| `EVENT_CHANNEL_ID` | channel ประกาศ **event** (activation/IP/expiry) — ตั้งสิทธิ์ให้เห็นเฉพาะแอดมิน (เว้นว่าง = รวมกับ ALERT) |
| `SPONSOR_REVIEW_CHANNEL_ID` | channel ที่แอดมินรีวิวใบสมัคร (D) |
| `SPONSOR_ANNOUNCE_CHANNEL_ID` | channel ประกาศ sponsor (ไม่บังคับ) |
| `SPONSOR_ROLE_ID` | role ที่ให้เมื่ออนุมัติ |
| `ADMIN_ROLE_ID` | role ที่กดอนุมัติ/ปฏิเสธได้ |
| `DATABASE_URL` | **ตัวเดียวกับ backend** |
| `SERVICE_PANEL_ENABLED` | เปิด/ปิด Service Status panel (default `true`) |
| `SERVICE_CHANNEL_ID` | ช่องโชว์ Service panel (เว้นว่าง = `ALERT_CHANNEL_ID`) |
| `SERVICE_HEALTH_URL` / `SERVICE_PM2_URL` / `SERVICE_INCIDENTS_URL` | endpoint ดึงสถานะ SIRU-SKIN — ใช้ `localhost` บน VPS เลี่ยง Cloudflare |
| `FIGURA_PANEL_ENABLED` / `FIGURA_CHANNEL_ID` | เปิด/ปิด + ช่องของ Figura panel |
| `FIGURA_STATS_URL` / `FIGURA_VERSION_URL` / `FIGURA_MOTD_URL` | endpoint Figura (Rust port 3011) — default `localhost` |
| `OFFLINE_AFTER_MINUTES` | heartbeat เงียบเกินกี่นาที = offline (default 6) |
| `EXPIRY_WARN_DAYS` | เตือนใกล้หมดอายุที่กี่วัน เช่น `3,1` |
| `MONITOR_CRON` | รอบสแกน (default ทุก 1 นาที) |
| `SPONSOR_MIN_*` | เงื่อนไขสมัคร sponsor (อายุสมาชิก/อายุเซิร์ฟ/คนออนไลน์) |
| `SPONSOR_GRANT_DAYS` | จำนวนวันที่ขยายอายุให้เมื่ออนุมัติ |

## สิทธิ์ Discord ที่ต้องเปิด

- **Bot Token Intents (privileged):** เปิด **Server Members Intent** ใน Developer Portal
  (ใช้ดู `joinedAt` ของผู้สมัคร และให้ role)
- **Bot permissions ในเซิร์ฟเวอร์:** Send Messages, Embed Links, Manage Roles, Manage Messages (สำหรับ pin dashboard)
- ลำดับ role: role ของ bot ต้อง **อยู่สูงกว่า** `SPONSOR_ROLE_ID` ไม่งั้นให้ role ไม่ได้

## คำสั่ง

| `/topup [amount]` | ทุกคน | เติมเงิน Figura Cloud ผ่าน PromptPay อัตโนมัติ (Stripe) โดยไม่ต้องส่งสลิป |
| `/topup-panel` | แอดมิน | ติดตั้งกล่องเติมเงิน Topup Panel ในห้องที่ต้องการ |
| `/sponsor-apply <server>` | ทุกคน | สมัคร sponsor (bot ตรวจเงื่อนไขก่อน) |
| `/serverstatus <server>` | ทุกคน | ดูสถานะ server แบบสด |
| ปุ่ม อนุมัติ/ปฏิเสธ | ADMIN_ROLE หรือ Manage Server | ตัดสินใบสมัคร |

slash commands ลงทะเบียนอัตโนมัติตอน bot สตาร์ท (แบบ guild เห็นผลทันที)
หรือสั่งเองด้วย `npm run deploy-commands`

## รัน 24/7 บน VPS

**แบบ pm2 (แนะนำ):**
```bash
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup    # ให้ขึ้นเองตอน reboot
pm2 logs siru-skin-bot
```

**แบบ systemd:** แก้ `<USER>`/`<PATH>` ใน `siru-skin-bot.service` แล้ว:
```bash
sudo cp siru-skin-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now siru-skin-bot
journalctl -u siru-skin-bot -f
```

## ตั้งช่องประกาศ event ให้เห็นเฉพาะแอดมิน

ที่ `EVENT_CHANNEL_ID` → ตั้ง permission ของ channel ใน Discord:
- `@everyone` → ปิด **View Channel**
- `ADMIN_ROLE_ID` → เปิด **View Channel**

bot โพสต์ event ลงช่องนี้ ส่วน Dashboard อยู่ช่องสาธารณะ (`ALERT_CHANNEL_ID`) แยกกัน

## หมายเหตุการตรวจ online

นับ "ผู้เล่นออนไลน์" จากตาราง `PlayerSession` (`lastPing` ภายใน 2 นาที)
ไม่ได้พึ่ง Redis เพื่อให้ bot ต่อแค่ Postgres อย่างเดียว
