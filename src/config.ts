import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Env ${name} must be a number, got "${v}"`);
  return n;
}

function csvNums(name: string, fallback: number[]): number[] {
  const v = process.env[name];
  if (!v) return fallback;
  return v
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));
}

// รับ Base IP/Domain ของบริการต่างๆ
const SERVICE_BASE_URL = process.env.SERVICE_BASE_URL || "http://localhost";
const FIGURA_BASE_URL = process.env.FIGURA_BASE_URL || "http://localhost";

export const config = {
  discord: {
    token: required("DISCORD_TOKEN"),
    clientId: required("DISCORD_CLIENT_ID"),
    guildId: required("GUILD_ID"),
    alertChannelId: process.env.ALERT_CHANNEL_ID || "",
    // ช่องประกาศ event (activation/IP/expiry) — ตั้งสิทธิ์ใน Discord ให้เห็นเฉพาะแอดมิน
    // ถ้าไม่ตั้ง จะ fallback ไปใช้ ALERT_CHANNEL_ID เหมือนเดิม
    eventChannelId: process.env.EVENT_CHANNEL_ID || "",
    sponsorReviewChannelId: required("SPONSOR_REVIEW_CHANNEL_ID"),
    sponsorAnnounceChannelId: process.env.SPONSOR_ANNOUNCE_CHANNEL_ID || "",
    sponsorRoleId: required("SPONSOR_ROLE_ID"),
    adminRoleId: required("ADMIN_ROLE_ID"),
  },
  databaseUrl: required("DATABASE_URL"),
  monitor: {
    offlineAfterMinutes: num("OFFLINE_AFTER_MINUTES", 6),
    expiryWarnDays: csvNums("EXPIRY_WARN_DAYS", [3, 1]),
    cron: process.env.MONITOR_CRON || "*/1 * * * *",
  },
  // Service status panel (เลียนแบบ siruskin-status page) — ดึงจาก backend/status server
  service: {
    enabled: (process.env.SERVICE_PANEL_ENABLED ?? "true") !== "false",
    channelId: process.env.SERVICE_CHANNEL_ID || "",
    healthUrl: process.env.SERVICE_HEALTH_URL || "http://localhost:3000/health",
    pm2Url: process.env.SERVICE_PM2_URL || "http://localhost:3009/api/pm2",
    incidentsUrl: process.env.SERVICE_INCIDENTS_URL || "http://localhost:3009/api/incidents",
  },
  // Service status panel ของ SIRU-FiguraCloud (Rust + SQLite, port 3011)
  figura: {
    enabled: (process.env.FIGURA_PANEL_ENABLED ?? "true") !== "false",
    channelId: process.env.FIGURA_CHANNEL_ID || "",
    topupChannelId: process.env.FIGURA_TOPUP_CHANNEL_ID || process.env.FIGURA_CHANNEL_ID || "",
    apiUrl: process.env.FIGURA_API_URL || "https://figura-siruapi.shirounetwork.com",
    healthUrl: process.env.FIGURA_HEALTH_URL || "https://figura-siruapi.shirounetwork.com/health",
    node1HealthUrl: process.env.FIGURA_NODE1_HEALTH_URL || "https://figura-siruapi.shirounetwork.com/health",
    node2HealthUrl: process.env.FIGURA_NODE2_HEALTH_URL || "http://82.26.104.170/health",
    node1MotdUrl: process.env.FIGURA_NODE1_MOTD_URL || "https://figura-siruapi.shirounetwork.com/api/motd",
    node2MotdUrl: process.env.FIGURA_NODE2_MOTD_URL || "http://82.26.104.170/api/motd",
    statsUrl: process.env.FIGURA_STATS_URL || "https://figura-siruapi.shirounetwork.com/api/stats",
    versionUrl: process.env.FIGURA_VERSION_URL || "https://figura-siruapi.shirounetwork.com/api/version",
    motdUrl: process.env.FIGURA_MOTD_URL || "https://figura-siruapi.shirounetwork.com/api/motd",
    serverMonthlyPrice: num("FIGURA_SERVER_PRICE", 50),
    roleId: process.env.FIGURA_ROLE_ID || "1492768247680860206",
    topupNoticeChannelId: process.env.TOPUP_NOTICE_CHANNEL_ID || "1548613195051307099",
  },
  // Cluster Node Status panel (SIRU Network High-Availability Failover)
  cluster: {
    enabled: (process.env.CLUSTER_PANEL_ENABLED ?? "true") !== "false",
    channelId: process.env.CLUSTER_CHANNEL_ID || process.env.FIGURA_CHANNEL_ID || process.env.SERVICE_CHANNEL_ID || "",
  },
  // Cloudflare Status panel (ดึงจาก https://www.cloudflarestatus.com/api/v2/summary.json)
  cloudflare: {
    enabled: (process.env.CLOUDFLARE_PANEL_ENABLED ?? "true") !== "false",
    channelId: process.env.CLOUDFLARE_CHANNEL_ID || "",
    summaryUrl: process.env.CLOUDFLARE_SUMMARY_URL || "https://www.cloudflarestatus.com/api/v2/summary.json",
  },
  sponsor: {
    minMemberDays: num("SPONSOR_MIN_MEMBER_DAYS", 7),
    minServerAgeDays: num("SPONSOR_MIN_SERVER_AGE_DAYS", 7),
    minOnlinePlayers: num("SPONSOR_MIN_ONLINE_PLAYERS", 3),
    requiredRoleId: process.env.SPONSOR_REQUIRED_ROLE_ID || "",
    grantDays: num("SPONSOR_GRANT_DAYS", 90),
  },
} as const;
