import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ContainerBuilder,
  Message,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextChannel,
  TextDisplayBuilder,
} from "discord.js";
import { exec } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { config } from "./config.js";

const execAsync = promisify(exec);
import { getTotalOnlinePlayers, getTotalSkins } from "./db.js";
import {
  addWarnedCloudflareIncident,
  getCloudflareMessageId,
  getFiguraMessageId,
  getNodeStatusMessageId,
  getLastCloudflareIndicator,
  getServiceMessageId,
  isCloudflareIncidentWarned,
  setCloudflareMessageId,
  setFiguraMessageId,
  setNodeStatusMessageId,
  setLastCloudflareIndicator,
  setServiceMessageId,
} from "./store.js";

// ── รูปแบบข้อมูลจาก backend / status server ────────────────────────────────
interface Health {
  status: "ok" | "maintenance";
  maintenance: boolean;
  maintenanceUntil: string;
  db: boolean;
  uptime: number; // วินาที
  onlineSockets?: number;
}
interface Pm2Proc {
  id: number;
  status: string; // online | stopped | errored | ...
  restarts: number;
  cpu: number;
  memory: number; // bytes
}
interface Incident {
  id: number;
  type: string;
  startedAt: string;
  resolvedAt: string | null;
}
interface SkinStats {
  onlinePlayers: number;
  totalSkins: number;
}

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T | null> {
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SIRU-Bot/1.0",
        Accept: "application/json",
        Connection: "keep-alive",
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[fetchJson] ${url} returned HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[fetchJson] ${url} failed: ${(err as Error).message}`);
    return null;
  }
}

async function fetchJsonWithRetry<T>(
  url: string,
  timeoutMs = 6000,
  maxRetries = 2,
  delayMs = 1000
): Promise<T | null> {
  if (!url) return null;
  for (let i = 0; i <= maxRetries; i++) {
    const data = await fetchJson<T>(url, timeoutMs);
    if (data !== null) return data;
    if (i < maxRetries) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}

function ts(date: Date | string, fmt: "R" | "f" | "F" | "t" | "T" | "d" | "D" = "f"): string {
  return `<t:${Math.floor(new Date(date).getTime() / 1000)}:${fmt}>`;
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

function fmtMem(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

function pm2Emoji(status: string): string {
  if (status === "online") return "🟢";
  if (status === "stopped") return "⚪";
  return "🔴"; // errored / launching / unknown
}

function buildServiceContainer(
  health: Health | null,
  pm2: Pm2Proc[] | null,
  incidents: Incident[] | null,
  stats?: SkinStats | null,
  clusterHealth?: FiguraHealth | null
): ContainerBuilder {
  const apiOk = health !== null;
  const dbOk = apiOk && health!.db === true;
  const maint = apiOk && health!.maintenance === true;

  // สถานะรวม
  let overall: string;
  let accent: number;
  if (!apiOk) {
    overall = "🔴 Major Outage — API ติดต่อไม่ได้";
    accent = 0xe74c3c;
  } else if (maint) {
    overall = "🟧 Maintenance — ปิดปรับปรุง";
    accent = 0xe67e22;
  } else if (!dbOk) {
    overall = "🔴 Degraded — Database มีปัญหา";
    accent = 0xe74c3c;
  } else {
    overall = "🟢 Operational — ระบบปกติ";
    accent = 0x2ecc71;
  }

  const container = new ContainerBuilder().setAccentColor(accent);
  const sepSmall = (divider = false) => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(divider);
  const sepLarge = (divider = false) => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(divider);
  const text = (c: string) => container.addTextDisplayComponents(new TextDisplayBuilder().setContent(c));

  text(`## 🛰️ SIRU-SKIN · Service Status\n-# อัพเดต ${ts(new Date(), "R")}`);
  container.addSeparatorComponents(sepLarge(true));
  text(`### สถานะรวม\n${overall}`);

  const nodeName = clusterHealth?.node_name || (clusterHealth?.node_role === "standby" ? "Node 2 (Cloud VPS)" : "Node 1 (Local Server)");
  const nodeRegion = clusterHealth?.node_region || (clusterHealth?.node_role === "standby" ? "TH-Central" : "TH-South");
  const nodeRoleIcon = clusterHealth?.node_role === "standby" ? "🟡" : "🟢";

  // บริการหลัก
  const coreLines = [
    `${apiOk ? "🟢" : "🔴"} **API Server**  ·  ${apiOk ? `uptime ${fmtUptime(health!.uptime)}` : "ออฟไลน์"}`,
    `${dbOk ? "🟢" : "🔴"} **Database**  ·  ${dbOk ? "เชื่อมต่อปกติ" : apiOk ? "เชื่อมต่อไม่ได้" : "ไม่ทราบสถานะ"}`,
    apiOk ? `${nodeRoleIcon} **Serving Node**  ·  \`${nodeName}\` (\`${nodeRegion}\`)` : null,
  ].filter(Boolean) as string[];
  if (maint && health!.maintenanceUntil) coreLines.push(`-# 🛠️ คาดว่าเปิดอีกครั้ง ${health!.maintenanceUntil}`);
  container.addSeparatorComponents(sepSmall(false));
  text(coreLines.join("\n"));

  // PM2 clusters
  if (pm2 && pm2.length > 0) {
    container.addSeparatorComponents(sepLarge(true));
    text(`### ⚙️ PM2 Clusters · ${pm2.length}`);
    const lines = pm2
      .slice(0, 8)
      .map(
        (p) =>
          `${pm2Emoji(p.status)} **Cluster #${p.id}**  ·  ↻ ${p.restarts}  ·  CPU ${p.cpu}%  ·  RAM ${fmtMem(p.memory)}`
      );
    container.addSeparatorComponents(sepSmall(false));
    text(lines.join("\n"));
  }

  // Incidents
  container.addSeparatorComponents(sepLarge(true));
  if (incidents && incidents.length > 0) {
    text("### 🚨 Incidents ล่าสุด");
    container.addSeparatorComponents(sepSmall(false));
    const lines = incidents.slice(0, 5).map((inc) => {
      if (inc.resolvedAt) {
        return `✅ **${inc.type}** — ${ts(inc.startedAt, "f")} → แก้ไขแล้ว ${ts(inc.resolvedAt, "R")}`;
      }
      return `🔴 **${inc.type}** — เริ่ม ${ts(inc.startedAt, "R")} · ⚠️ ยังไม่แก้ไข`;
    });
    text(lines.join("\n"));
  } else {
    text("-# 🛡️ Incidents: ปกติ ไม่มีเหตุขัดข้องล่าสุด");
  }

  return container;
}

async function fetchTextChannel(client: Client, id: string): Promise<TextChannel | null> {
  if (!id) return null;
  try {
    const ch = await client.channels.fetch(id);
    if (ch && ch.isTextBased()) return ch as TextChannel;
    console.error("[service] SERVICE_CHANNEL_ID is not a text channel");
  } catch (err) {
    console.error("[service] cannot fetch service channel:", (err as Error).message);
  }
  return null;
}

/**
 * Auto-discovers an existing message posted by this bot matching a keyword,
 * first searching pinned messages, then searching recent channel messages.
 */
export async function findExistingBotMessage(
  channel: TextChannel,
  keyword: string
): Promise<Message | null> {
  const botId = channel.client.user?.id;
  if (!botId) return null;

  try {
    // 1. Check pinned messages first (all panels are pinned)
    const pinned = await channel.messages.fetchPinned();
    const foundPin = pinned.find(
      (m) =>
        m.author.id === botId &&
        (m.content?.includes(keyword) || JSON.stringify(m.components).includes(keyword))
    );
    if (foundPin) return foundPin;

    // 2. Fallback: check recent 25 messages in channel
    const recent = await channel.messages.fetch({ limit: 25 });
    const foundRecent = recent.find(
      (m) =>
        m.author.id === botId &&
        (m.content?.includes(keyword) || JSON.stringify(m.components).includes(keyword))
    );
    if (foundRecent) return foundRecent;
  } catch (err) {
    console.warn(`[findExistingBotMessage] failed for keyword "${keyword}":`, (err as Error).message);
  }

  return null;
}

export async function renderServicePanel(client: Client): Promise<void> {
  if (!config.service.enabled) return;

  const channel = await fetchTextChannel(client, config.service.channelId);
  if (!channel) return;

  const [health, pm2, incidents, onlinePlayers, totalSkins, clusterHealth] = await Promise.all([
    fetchJsonWithRetry<Health>(config.service.healthUrl, 6000, 2),
    config.service.pm2Url ? fetchJson<Pm2Proc[]>(config.service.pm2Url) : Promise.resolve(null),
    config.service.incidentsUrl ? fetchJson<Incident[]>(config.service.incidentsUrl) : Promise.resolve(null),
    getTotalOnlinePlayers(),
    getTotalSkins(),
    fetchJsonWithRetry<FiguraHealth>(config.figura.healthUrl, 6000, 2),
  ]);

  const activeOnline = Math.max(onlinePlayers, health?.onlineSockets ?? 0);

  const container = buildServiceContainer(
    health,
    pm2,
    incidents,
    {
      onlinePlayers: activeOnline,
      totalSkins,
    },
    clusterHealth
  );
  let existingId = getServiceMessageId();
  if (!existingId) {
    const existingMsg = await findExistingBotMessage(channel, "SIRU-SKIN");
    if (existingMsg) {
      existingId = existingMsg.id;
      setServiceMessageId(existingId);
    }
  }

  if (existingId) {
    try {
      const msg = await channel.messages.fetch(existingId);
      await msg.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    } catch {
      // ข้อความเดิมหาย/แก้ไม่ได้ → สร้างใหม่
    }
  }
  const msg = await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
  setServiceMessageId(msg.id);
  msg.pin().catch(() => { });
}

// ── SIRU-FiguraCloud (Rust + SQLite) ──────────────────────────────────────
interface FiguraStats {
  online: number;
  whitelisted: number;
  server_address: string;
}
interface FiguraVersion {
  release: string;
  prerelease: string;
}
export interface FiguraHealth {
  status: string;
  service: string;
  node_role: string;
  node_name: string;
  node_region: string;
  version: string;
  uptime?: number;
  system_uptime?: number;
}
type Motd = { text: string }[];

function parseUptimeFromMotd(motd: Motd | null): string | null {
  if (!motd) return null;
  const el = motd.find((m) => typeof m.text === "string" && m.text.includes("Uptime:"));
  if (!el) return null;
  return el.text.replace(/Uptime:\s*/i, "").trim() || null;
}

function buildFiguraContainer(
  stats: FiguraStats | null,
  version: FiguraVersion | null,
  uptime: string | null,
  health: FiguraHealth | null
): ContainerBuilder {
  // stats hits API + ทำ DB query → ถ้าได้ = API+DB ปกติ
  const apiOk = stats !== null;
  const accent = apiOk ? 0x2ecc71 : 0xe74c3c;
  const overall = apiOk ? "🟢 Operational — ระบบปกติ" : "🔴 Major Outage — API ติดต่อไม่ได้";

  const container = new ContainerBuilder().setAccentColor(accent);
  const sepSmall = () => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false);
  const sepLarge = (d = false) => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(d);
  const text = (c: string) => container.addTextDisplayComponents(new TextDisplayBuilder().setContent(c));

  text(`## 🎭 SIRU-FiguraCloud · Service Status\n-# อัพเดต ${ts(new Date(), "R")}`);
  container.addSeparatorComponents(sepLarge(true));
  text(`### สถานะรวม\n${overall}`);

  const nodeName = health?.node_name || (health?.node_role === "standby" ? "Node 2 (Cloud VPS)" : "Node 1 (Local Server)");
  const nodeRegion = health?.node_region || (health?.node_role === "standby" ? "TH-Central" : "TH-South");
  const nodeRoleIcon = health?.node_role === "standby" ? "🟡" : "🟢";

  const core = [
    `${apiOk ? "🟢" : "🔴"} **API Server**  ·  ${uptime ? `uptime ${uptime}` : "ทำงานปกติ"}`,
    `${apiOk ? "🟢" : "🔴"} **Database**  ·  ${apiOk ? "เชื่อมต่อปกติ" : "ไม่ทราบสถานะ"}`,
    apiOk ? `${nodeRoleIcon} **Serving Node**  ·  \`${nodeName}\` (\`${nodeRegion}\`)` : null,
  ].filter(Boolean) as string[];

  container.addSeparatorComponents(sepSmall());
  text(core.join("\n"));

  if (apiOk) {
    container.addSeparatorComponents(sepLarge(true));
    text("### 📊 สถิติ");
    const lines = [
      `👥 ออนไลน์: **${stats!.online}**`,
      `📝 Whitelist: **${stats!.whitelisted}** คน`,
      version ? `🏷️ Version: \`${version.release}\`` : null,
    ].filter(Boolean) as string[];
    container.addSeparatorComponents(sepSmall());
    text(lines.join("\n"));
  }

  return container;
}

export async function renderFiguraPanel(client: Client): Promise<void> {
  if (!config.figura.enabled) return;

  const channel = await fetchTextChannel(client, config.figura.channelId);
  if (!channel) return;

  const [stats, version, motd, health] = await Promise.all([
    fetchJsonWithRetry<FiguraStats>(config.figura.statsUrl, 6000, 2),
    fetchJsonWithRetry<FiguraVersion>(config.figura.versionUrl, 6000, 2),
    fetchJsonWithRetry<Motd>(config.figura.motdUrl, 6000, 2),
    fetchJsonWithRetry<FiguraHealth>(config.figura.healthUrl, 6000, 2),
  ]);

  const container = buildFiguraContainer(stats, version, parseUptimeFromMotd(motd), health);
  let existingId = getFiguraMessageId();
  if (!existingId) {
    const existingMsg = await findExistingBotMessage(channel, "SIRU-FiguraCloud");
    if (existingMsg) {
      existingId = existingMsg.id;
      setFiguraMessageId(existingId);
    }
  }

  if (existingId) {
    try {
      const msg = await channel.messages.fetch(existingId);
      await msg.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    } catch {
      // ข้อความเดิมหาย/แก้ไม่ได้ → สร้างใหม่
    }
  }
  const msg = await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
  setFiguraMessageId(msg.id);
  msg.pin().catch(() => { });
}

export interface NodeProbeResult {
  online: boolean;
  pingMs: number;
  uptime: string | null;
  data: FiguraHealth | null;
}

export interface SyncInfo {
  timestamp: number;
  status: "success" | "failed" | string;
}

function cleanUptime(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/(?:(\d+d)\s*)?(?:(\d+h)\s*)?(?:(\d+m)\s*)?/i);
  if (m) {
    const parts = [m[1], m[2], m[3]].filter(Boolean);
    if (parts.length > 0) return `up ${parts.slice(0, 2).join(" ")}`;
  }
  return `up ${raw}`;
}

async function readLastSyncInfo(): Promise<SyncInfo | null> {
  const syncFilePath = process.env.SYNC_FILE_PATH || "/home/siru-pc/Desktop/Figura-SIRU-prod/failover/last_sync.json";
  try {
    const content = await fs.readFile(syncFilePath, "utf-8");
    return JSON.parse(content) as SyncInfo;
  } catch {
    return null;
  }
}

let cachedNode2Uptime: { uptime: string; time: number } | null = null;

async function fetchNode2Uptime(): Promise<string | null> {
  if (cachedNode2Uptime && Date.now() - cachedNode2Uptime.time < 60_000) {
    return cachedNode2Uptime.uptime;
  }
  try {
    const motd = await fetchJson<Motd>(config.figura.node2MotdUrl);
    const uptime = parseUptimeFromMotd(motd);
    if (uptime) {
      cachedNode2Uptime = { uptime, time: Date.now() };
      return uptime;
    }
  } catch { }
  return cachedNode2Uptime?.uptime ?? null;
}

async function fetchNode1Uptime(): Promise<string | null> {
  try {
    const motd = await fetchJson<Motd>(config.figura.node1MotdUrl);
    return parseUptimeFromMotd(motd);
  } catch {
    return null;
  }
}

export async function getClusterNodesStatus(): Promise<{
  active: FiguraHealth | null;
  node1: NodeProbeResult;
  node2: NodeProbeResult;
  lastSync: SyncInfo | null;
}> {
  const pingNodeHttp = async (url: string, maxRetries = 2) => {
    let lastData: FiguraHealth | null = null;
    let start = Date.now();
    for (let i = 0; i <= maxRetries; i++) {
      start = Date.now();
      lastData = await fetchJson<FiguraHealth>(url);
      if (lastData !== null) {
        return { online: true, pingMs: Date.now() - start, data: lastData };
      }
      if (i < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    return { online: false, pingMs: Date.now() - start, data: null };
  };

  const probeNode1 = async (): Promise<NodeProbeResult> => {
    const [res, motdUptime] = await Promise.all([
      pingNodeHttp(config.figura.node1HealthUrl),
      fetchNode1Uptime(),
    ]);
    const uptime = res.data?.system_uptime ? fmtUptime(res.data.system_uptime) : motdUptime;
    return { ...res, uptime };
  };

  const probeNode2 = async (): Promise<NodeProbeResult> => {
    const [httpRes, motdUptime] = await Promise.all([
      pingNodeHttp(config.figura.node2HealthUrl),
      fetchNode2Uptime(),
    ]);
    const uptime = httpRes.data?.system_uptime ? fmtUptime(httpRes.data.system_uptime) : motdUptime;
    if (httpRes.online) return { ...httpRes, uptime };

    // Fallback SSH probe
    const start = Date.now();
    try {
      const { stdout } = await execAsync(
        'ssh -o ConnectTimeout=2 -o BatchMode=yes dritestudio@82.26.104.170 "curl -s http://127.0.0.1:3110/health"',
        { timeout: 3000 }
      );
      const data = JSON.parse(stdout.trim()) as FiguraHealth;
      if (data && data.status === "ok") {
        const sshUptime = data.system_uptime ? fmtUptime(data.system_uptime) : uptime;
        return { online: true, pingMs: Date.now() - start, uptime: sshUptime, data };
      }
    } catch { }

    return { online: false, pingMs: Date.now() - start, uptime: null, data: null };
  };

  const [active, n1, n2, lastSync] = await Promise.all([
    fetchJson<FiguraHealth>(config.figura.healthUrl),
    probeNode1(),
    probeNode2(),
    readLastSyncInfo(),
  ]);

  return { active, node1: n1, node2: n2, lastSync };
}

export function buildNodeStatusContainer(
  active: FiguraHealth | null,
  node1: NodeProbeResult,
  node2: NodeProbeResult,
  lastSync: SyncInfo | null = null
): ContainerBuilder {
  const isFailover = active?.node_role === "standby";
  const allUp = node1.online && node2.online;
  const anyUp = node1.online || node2.online;

  let accent = 0x2ecc71; // เขียว
  let overall = "🟢 Operational — คลัสเตอร์ปกติ 100%";
  if (isFailover) {
    accent = 0xf39c12; // ส้ม
    overall = "🟡 Failover Active — ให้บริการผ่าน Node 2 สำรอง";
  } else if (!allUp) {
    accent = 0xe74c3c; // แดง
    overall = anyUp ? "🟠 Degraded — มีบาง Node ออฟไลน์" : "🔴 Outage — ทุกลิสต์ออฟไลน์";
  }

  const container = new ContainerBuilder().setAccentColor(accent);
  const sepSmall = (d = false) => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(d);
  const sepLarge = (d = false) => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(d);
  const text = (c: string) => container.addTextDisplayComponents(new TextDisplayBuilder().setContent(c));

  text(`## 🌐 SIRU-Network · Node Status\n-# อัพเดต ${ts(new Date(), "R")}`);
  container.addSeparatorComponents(sepLarge(true));
  text(`### สถานะรวม\n${overall}`);

  const n1Tag = isFailover ? "`Standby`" : "`Active` 📌";
  const n2Tag = isFailover ? "`Active (Failover)` 📌" : "`Standby`";

  const n1Up = node1.online && node1.uptime ? `  ·  \`${cleanUptime(node1.uptime)}\`` : "";
  const n2Up = node2.online && node2.uptime ? `  ·  \`${cleanUptime(node2.uptime)}\`` : "";

  const n1Line = node1.online
    ? `🟢 **Node 1 (Local Server)**  ·  \`TH-South\`${n1Up}  ·  ${n1Tag}`
    : `🔴 **Node 1 (Local Server)**  ·  \`TH-South\`  ·  \`Offline\``;

  const n2Line = node2.online
    ? `🟢 **Node 2 (Cloud VPS)**  ·  \`TH-Central\`${n2Up}  ·  ${n2Tag}`
    : `🔴 **Node 2 (Cloud VPS)**  ·  \`TH-Central\`  ·  \`Offline\``;

  container.addSeparatorComponents(sepSmall());
  text([n1Line, n2Line].join("\n"));

  container.addSeparatorComponents(sepLarge(true));
  const syncText = lastSync
    ? `🔄 ซิงก์ล่าสุด: <t:${lastSync.timestamp}:R> (${lastSync.status === "success" ? "ปกติ" : "⚠️ ขัดข้อง"})`
    : `🔄 Continuous Sync: \`ทุก 30 นาที\``;

  text(`-# 🛡️ Auto-Failover: \`Active\` ·  ${syncText}`);

  return container;
}

export async function renderNodeStatusPanel(client: Client): Promise<void> {
  if (!config.cluster.enabled) return;

  const channel = await fetchTextChannel(client, config.cluster.channelId);
  if (!channel) return;

  const cluster = await getClusterNodesStatus();
  const container = buildNodeStatusContainer(cluster.active, cluster.node1, cluster.node2, cluster.lastSync);

  let existingId = getNodeStatusMessageId();
  if (!existingId) {
    const existingMsg = await findExistingBotMessage(channel, "SIRU-Network");
    if (existingMsg) {
      existingId = existingMsg.id;
      setNodeStatusMessageId(existingId);
    }
  }

  if (existingId) {
    try {
      const msg = await channel.messages.fetch(existingId);
      await msg.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    } catch {
      // หาย/แก้ไม่ได้ หรือย้าย Channel -> ลองลบข้อความเดิมจากห้องเก่า (ถ้ามี) แล้วสร้างใหม่
      const oldChannelId = config.figura.channelId || config.service.channelId;
      if (oldChannelId && oldChannelId !== channel.id) {
        try {
          const oldChan = await fetchTextChannel(client, oldChannelId);
          if (oldChan) {
            const oldMsg = await oldChan.messages.fetch(existingId);
            await oldMsg.delete().catch(() => { });
          }
        } catch { }
      }
    }
  }

  const msg = await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
  setNodeStatusMessageId(msg.id);
  msg.pin().catch(() => { });
}

// ── Cloudflare Status (Statuspage API) ──────────────────────────────────────
interface CFStatus {
  indicator: "none" | "minor" | "major" | "critical";
  description: string;
}
interface CFIncidentUpdate {
  id: string;
  status: string;
  body: string;
  created_at: string;
  updated_at: string;
}
interface CFIncident {
  id: string;
  name: string;
  status: string;
  impact: string;
  shortlink: string;
  started_at: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  incident_updates: CFIncidentUpdate[];
  components?: CFComponent[];
}
interface CFComponent {
  id: string;
  name: string;
  status: string;
  group: boolean;
}
interface CFMaintenance {
  id: string;
  name: string;
  status: string;
  impact: string;
  shortlink: string;
  scheduled_for: string;
  scheduled_until: string;
}
interface CloudflareSummary {
  page: {
    id: string;
    name: string;
    url: string;
    updated_at: string;
  };
  status: CFStatus;
  incidents: CFIncident[];
  scheduled_maintenances: CFMaintenance[];
  components: CFComponent[];
}

function cfStatusEmoji(status: string): string {
  if (status === "operational") return "🟢";
  if (status === "degraded_performance") return "🟡";
  if (status === "partial_outage") return "🟧";
  if (status === "major_outage") return "🔴";
  return "⚪";
}

function translateCFIncidentStatus(status: string): string {
  switch (status) {
    case "investigating":
      return "🔍 กำลังตรวจสอบ (Investigating)";
    case "identified":
      return "🛠️ พบสาเหตุแล้ว (Identified)";
    case "monitoring":
      return "👁️ กำลังติดตามผล (Monitoring)";
    case "resolved":
      return "✅ แก้ไขเรียบร้อย (Resolved)";
    case "postmortem":
      return "📝 สรุปหลังแก้ไข (Postmortem)";
    default:
      return status;
  }
}

function translateCFComponentStatus(status: string): { emoji: string; label: string } {
  switch (status) {
    case "operational":
      return { emoji: "🟢", label: "ปกติ" };
    case "degraded_performance":
      return { emoji: "🟡", label: "ประสิทธิภาพลดลง" };
    case "partial_outage":
      return { emoji: "🟧", label: "ขัดข้องบางส่วน" };
    case "major_outage":
      return { emoji: "🔴", label: "ขัดข้องรุนแรง" };
    case "under_maintenance":
      return { emoji: "⚪", label: "ปิดปรับปรุงตามแผน" };
    default:
      return { emoji: "❓", label: status };
  }
}

function cfImpactEmoji(impact: string): string {
  if (impact === "critical") return "🔴";
  if (impact === "major") return "🟧";
  if (impact === "minor") return "🟡";
  return "ℹ️";
}

function buildCloudflareContainer(summary: CloudflareSummary | null): ContainerBuilder {
  const apiOk = summary !== null;
  const indicator = summary?.status?.indicator ?? "major";

  let overall: string;
  let accent: number;

  if (!apiOk) {
    overall = "🔴 **Connection Error** — ไม่สามารถเชื่อมต่อ API ของ Cloudflare ได้";
    accent = 0xe74c3c;
  } else if (indicator === "none") {
    overall = "🟢 **Operational** — ทุกบริการหลักทำงานตามปกติ";
    accent = 0x2ecc71;
  } else if (indicator === "minor") {
    overall = `🟡 **Minor Outage** — มีบริการบางส่วนขัดข้อง (${summary!.status.description || "Minor Service Outage"})`;
    accent = 0xf1c40f;
  } else if (indicator === "major") {
    overall = `🟧 **Major Outage** — มีระบบขัดข้องเป็นวงกว้าง (${summary!.status.description || "Major Service Outage"})`;
    accent = 0xe67e22;
  } else {
    overall = `🔴 **Critical Outage** — ระบบขัดข้องร้ายแรง (${summary!.status.description || "Critical Service Outage"})`;
    accent = 0xe74c3c;
  }

  const container = new ContainerBuilder().setAccentColor(accent);
  const sepSmall = () => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false);
  const sepLarge = (d = false) => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(d);
  const text = (c: string) => container.addTextDisplayComponents(new TextDisplayBuilder().setContent(c));

  text(`## ☁️ Cloudflare Status\n-# ⏱️ อัปเดตล่าสุด: ${ts(new Date(), "t")} (${ts(new Date(), "R")})`);
  container.addSeparatorComponents(sepLarge(true));
  text(`### 📊 สถานะรวม\n${overall}`);

  // Incidents ล่าสุด
  container.addSeparatorComponents(sepLarge(true));
  text("### 🚨 รายงาน Incidents");
  container.addSeparatorComponents(sepSmall());

  if (summary && summary.incidents && summary.incidents.length > 0) {
    const lines = summary.incidents.slice(0, 5).map((inc) => {
      const impactIcon = cfImpactEmoji(inc.impact);
      const statusText = translateCFIncidentStatus(inc.status);
      const affectedCompNames =
        inc.components && inc.components.length > 0
          ? inc.components.map((c) => `\`${c.name}\``).join(", ")
          : null;

      const timeDetails = [
        `-# ⏱️ **เริ่มเมื่อ:** ${ts(inc.started_at, "f")} (${ts(inc.started_at, "R")})`,
        `-# 🔄 **อัปเดตล่าสุด:** ${ts(inc.updated_at, "f")} (${ts(inc.updated_at, "R")})`,
        `-# 📌 **สถานะ:** **${statusText}**`,
      ];
      if (affectedCompNames) {
        timeDetails.push(`-# 🎯 **บริการที่กระทบ:** ${affectedCompNames}`);
      }

      const latestMsg =
        inc.incident_updates && inc.incident_updates.length > 0
          ? `\n\n> ${inc.incident_updates[0].body.replace(/\n+/g, " ").slice(0, 200)}`
          : "";

      return `${impactIcon} **[${inc.name}](${inc.shortlink})**\n${timeDetails.join("\n")}${latestMsg}`;
    });
    text(lines.join("\n\n"));
  } else {
    text("-# ไม่มี incident ล่าสุด ✓");
  }

  // สถานะบริการหลัก (Core Services Overview)
  if (summary && summary.components) {
    const isDatacenter = (c: CFComponent) => /\s*-\s*\([A-Z]{3}\)$/u.test(c.name);
    const coreList = summary.components.filter((c) => !c.group && !isDatacenter(c));
    const degradedDC = summary.components.filter((c) => !c.group && isDatacenter(c) && c.status !== "operational");

    container.addSeparatorComponents(sepLarge(true));
    text("### ⚙️ สถานะบริการหลัก");
    container.addSeparatorComponents(sepSmall());

    const keyServices = [
      { name: "CDN / Edge Network", match: (n: string) => n === "cdn/cache" || n.includes("sites and services") },
      { name: "DNS (1.1.1.1 & Authoritative)", match: (n: string) => n.includes("authoritative dns") || n === "dns" },
      { name: "Cloudflare Workers & Pages", match: (n: string) => n === "workers" || n.includes("workers") },
      { name: "Dashboard & API", match: (n: string) => n.includes("dashboard") },
      { name: "WARP / Access", match: (n: string) => n === "warp" || n.includes("warp") },
    ];

    const keyLines = keyServices.map((ks) => {
      const comp = coreList.find((c) => ks.match(c.name.toLowerCase()));
      const statusObj = comp ? translateCFComponentStatus(comp.status) : { emoji: "🟢", label: "ปกติ" };
      const labelText = comp && comp.status !== "operational" ? `**${statusObj.label}**` : statusObj.label;
      return `${statusObj.emoji} **${ks.name}**   ·   ${labelText}`;
    });

    const bkkComp = summary.components.find((c) => c.name.includes("Bangkok") || c.name.includes("BKK"));
    const sinComp = summary.components.find((c) => c.name.includes("Singapore") || c.name.includes("SIN"));
    const bkkStatus = bkkComp ? translateCFComponentStatus(bkkComp.status).label : "ปกติ";
    const sinStatus = sinComp ? translateCFComponentStatus(sinComp.status).label : "ปกติ";

    const keyText = keyLines.join("\n");
    const dcNote = `\n\n-# 🌐 ศูนย์ข้อมูลภูมิภาค: 🇹🇭 BKK (${bkkStatus}) · 🇸🇬 SIN (${sinStatus}) · ปิดปรับปรุง/ส่งผลกระทบ ${degradedDC.length} แห่งทั่วโลก`;
    text(`${keyText}${dcNote}`);
  }

  return container;
}

export async function renderCloudflarePanel(client: Client): Promise<void> {
  if (!config.cloudflare.enabled) return;

  const channel = await fetchTextChannel(client, config.cloudflare.channelId);
  if (!channel) return;

  const summary = await fetchJson<CloudflareSummary>(config.cloudflare.summaryUrl);

  // ระบบแจ้งเตือนฉุกเฉินเมื่อ Cloudflare เกิด incident ใหม่ หรือเกิด Major/Critical Outage
  if (summary) {
    const alertChannelId = config.discord.eventChannelId || config.discord.alertChannelId;
    const lastIndicator = getLastCloudflareIndicator();
    const currentIndicator = summary.status?.indicator ?? "none";

    if (
      lastIndicator &&
      lastIndicator !== currentIndicator &&
      (currentIndicator === "major" || currentIndicator === "critical")
    ) {
      const alertChannel = await fetchTextChannel(client, alertChannelId);
      if (alertChannel) {
        const title = currentIndicator === "critical" ? "🔴 Critical Cloudflare Outage" : "🟧 Major Cloudflare Outage";
        await alertChannel
          .send({
            content: `⚠️ **[ALERT] ${title}**\nCloudflare รายงานสถานะระบบขัดข้องเป็นวงกว้าง: **${summary.status.description}**\n-# 🔗 ติดตามพาเนลสถานะได้ที่ช่อง <#${config.cloudflare.channelId}> หรือ [Cloudflare Status](${summary.page.url})`,
          })
          .catch(() => { });
      }
    }
    setLastCloudflareIndicator(currentIndicator);

    if (summary.incidents && summary.incidents.length > 0) {
      for (const inc of summary.incidents) {
        if (!isCloudflareIncidentWarned(inc.id) && inc.status !== "resolved") {
          addWarnedCloudflareIncident(inc.id);
          const alertChannel = await fetchTextChannel(client, alertChannelId);
          if (alertChannel) {
            const impactEmoji = cfImpactEmoji(inc.impact);
            await alertChannel
              .send({
                content: `🚨 **[Cloudflare Incident Alert]** ${impactEmoji} **[${inc.name}](${inc.shortlink})**\n-# 📌 สถานะ: **${translateCFIncidentStatus(
                  inc.status
                )}**\n> ${inc.incident_updates?.[0]?.body?.replace(/\n+/g, " ")?.slice(0, 250) || "มีรายงานเหตุการณ์ขัดข้องใหม่"}\n-# 🔗 ดูรายละเอียดพาเนลได้ที่ <#${config.cloudflare.channelId}>`,
              })
              .catch(() => { });
          }
        }
      }
    }
  }

  const container = buildCloudflareContainer(summary);

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("🌐 ดูหน้า Cloudflare Status")
      .setStyle(ButtonStyle.Link)
      .setURL("https://www.cloudflarestatus.com")
  );

  let existingId = getCloudflareMessageId();
  if (!existingId) {
    const existingMsg = await findExistingBotMessage(channel, "Cloudflare");
    if (existingMsg) {
      existingId = existingMsg.id;
      setCloudflareMessageId(existingId);
    }
  }

  if (existingId) {
    try {
      const msg = await channel.messages.fetch(existingId);
      await msg.edit({ components: [container, actionRow], flags: MessageFlags.IsComponentsV2 });
      return;
    } catch {
      // ข้อความเดิมหาย/แก้ไม่ได้ → สร้างใหม่
    }
  }
  const msg = await channel.send({ components: [container, actionRow], flags: MessageFlags.IsComponentsV2 });
  setCloudflareMessageId(msg.id);
  msg.pin().catch(() => { });
}

