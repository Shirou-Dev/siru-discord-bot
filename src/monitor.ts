import cron from "node-cron";
import {
  Client,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextChannel,
  TextDisplayBuilder,
} from "discord.js";
import { config } from "./config.js";
import { getAllServers, getOnlineCountsByServer, ServerRow } from "./db.js";
import {
  getDashboardMessageId,
  getServerState,
  setDashboardMessageId,
  setServerState,
  ServerState,
} from "./store.js";
import { renderCloudflarePanel, renderFiguraPanel, renderNodeStatusPanel, renderServicePanel } from "./service.js";

const DAY_MS = 86_400_000;

function isPersonal(plan: string): boolean {
  return plan.startsWith("personal");
}

function isOnline(server: ServerRow): boolean {
  if (!server.lastHeartbeat) return false;
  const ageMs = Date.now() - new Date(server.lastHeartbeat).getTime();
  return ageMs <= config.monitor.offlineAfterMinutes * 60 * 1000;
}

function daysLeft(expiresAt: Date): number {
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / DAY_MS);
}

function ts(date: Date, fmt: "R" | "f"): string {
  return `<t:${Math.floor(new Date(date).getTime() / 1000)}:${fmt}>`;
}

// ── Event alerts (โพสต์แยกแต่ละครั้ง) ──────────────────────────────────────
type EventKind = "activated" | "ip-change" | "expiry";

function buildEventContainer(kind: EventKind, server: ServerRow, extra: Record<string, string> = {}): ContainerBuilder {
  const meta: Record<EventKind, { title: string; color: number }> = {
    activated: { title: "✅ Server Activated", color: 0x3498db },
    "ip-change": { title: "🛡️ IP เปลี่ยน (ตรวจสอบความปลอดภัย)", color: 0xf1c40f },
    expiry: { title: "⏰ ใกล้หมดอายุ", color: 0xe67e22 },
  };
  const m = meta[kind];
  const container = new ContainerBuilder().setAccentColor(m.color);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${m.title}\n**${server.name}**  ·  \`${server.plan}\``)
  );
  const details = Object.entries(extra).map(([k, v]) => `${k}: ${v}`);
  details.push(`-# Server ID: \`${server.id}\`  ·  ${ts(new Date(), "R")}`);
  container.addSeparatorComponents(sep(SeparatorSpacingSize.Small, true));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(details.join("\n")));
  return container;
}

// ── Dashboard (online/offline รวมในข้อความเดียว edit ซ้ำ) ───────────────────
type Group = "server" | "personal" | "expired";

function groupOf(s: ServerRow): Group {
  if (new Date(s.expiresAt).getTime() < Date.now()) return "expired";
  return isPersonal(s.plan) ? "personal" : "server";
}

// ลำดับความเด่นภายในกลุ่ม server: offline > ยังไม่ activate > online
function serverRank(s: ServerRow): number {
  if (!s.isActive) return 1;
  return isOnline(s) ? 2 : 0;
}

// ── Components V2: บรรทัดข้อความของแต่ละเซิร์ฟ ──────────────────────────────
function serverText(s: ServerRow, online: number): string {
  if (!s.isActive) {
    return `🟡 **${s.name}**  ·  \`${s.plan}\`\n-# 🔧 ยังไม่ activate — พิมพ์ \`/siruskinverify\` ในคอนโซล`;
  }
  if (isOnline(s)) {
    const hb = s.lastHeartbeat ? ts(s.lastHeartbeat, "R") : "—";
    return `🟢 **${s.name}**  ·  \`${s.plan}\`\n-# 👥 ${online} ออนไลน์   •   ⏱️ heartbeat ${hb}`;
  }
  const hb = s.lastHeartbeat ? ts(s.lastHeartbeat, "R") : "ไม่เคย heartbeat";
  return `🔴 **${s.name}**  ·  \`${s.plan}\`\n-# ⚠️ ออฟไลน์   •   ⏱️ ล่าสุด ${hb}`;
}

function personalText(s: ServerRow): string {
  return `⚪ **${s.name}**  ·  \`${s.plan}\``;
}

function expiredText(s: ServerRow): string {
  return `⛔ **${s.name}**  ·  \`${s.plan}\`\n-# หมดอายุ ${ts(s.expiresAt, "R")}`;
}

function sep(spacing: SeparatorSpacingSize, divider = false): SeparatorBuilder {
  return new SeparatorBuilder().setSpacing(spacing).setDivider(divider);
}

// Components V2 จำกัด 40 components/ข้อความ — เผื่อ margin ไว้
const MAX_COMPONENTS = 38;

function buildDashboardContainer(servers: ServerRow[], online: Map<string, number>): ContainerBuilder {
  const groups: Record<Group, ServerRow[]> = { server: [], personal: [], expired: [] };
  for (const s of servers) groups[groupOf(s)].push(s);

  groups.server.sort((a, b) => serverRank(a) - serverRank(b) || a.name.localeCompare(b.name));
  groups.personal.sort((a, b) => a.name.localeCompare(b.name));
  groups.expired.sort((a, b) => a.name.localeCompare(b.name));

  const onlineCount = groups.server.filter((s) => s.isActive && isOnline(s)).length;
  const offlineCount = groups.server.filter((s) => s.isActive && !isOnline(s)).length;

  const accent = offlineCount > 0 ? 0xe74c3c : servers.length ? 0x2ecc71 : 0x95a5a6;
  const container = new ContainerBuilder().setAccentColor(accent);

  // นับ component ที่ใส่ไปแล้ว (container เองนับ 1) — กันเกินลิมิต
  let used = 1;
  const addText = (content: string): boolean => {
    if (used >= MAX_COMPONENTS) return false;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    used++;
    return true;
  };
  const addSep = (spacing: SeparatorSpacingSize, divider = false): boolean => {
    if (used >= MAX_COMPONENTS) return false;
    container.addSeparatorComponents(sep(spacing, divider));
    used++;
    return true;
  };

  // หัวเรื่อง
  addText(`## 📊 สถานะเซิร์ฟเวอร์\n-# SIRU-SKIN · Server Monitor · อัพเดต ${ts(new Date(), "R")}`);

  let sectionCount = 0;
  let truncated = 0;
  const addSection = (title: string, list: ServerRow[], render: (s: ServerRow) => string) => {
    if (list.length === 0) return;
    addSep(SeparatorSpacingSize.Large, sectionCount > 0);
    addText(`### ${title}`);
    list.forEach((s, i) => {
      // กันบล็อกท้าย (truncation note + footer = 3) ให้พอที่
      if (used + 2 > MAX_COMPONENTS - 3) {
        truncated++;
        return;
      }
      addSep(SeparatorSpacingSize.Small, i === 0);
      addText(render(s));
    });
    sectionCount++;
  };

  addSection(`🖥️ เซิร์ฟเวอร์ · ${groups.server.length}`, groups.server, (s) => serverText(s, online.get(s.id) ?? 0));
  addSection(`👤 Personal · ${groups.personal.length}`, groups.personal, personalText);
  addSection(`⛔ หมดอายุ · ${groups.expired.length}`, groups.expired, expiredText);

  if (servers.length === 0) addText("_ไม่มีเซิร์ฟเวอร์_");
  if (truncated > 0) addText(`-# …และอีก ${truncated} เซิร์ฟ (เกินลิมิตการแสดงผล) — ใช้ \`/serverstatus\``);

  // สรุปท้าย
  addSep(SeparatorSpacingSize.Large, true);
  addText(`-# 🟢 ${onlineCount} ออนไลน์   🔴 ${offlineCount} ออฟไลน์`);

  return container;
}

async function fetchTextChannel(client: Client, id: string, label: string): Promise<TextChannel | null> {
  if (!id) return null;
  try {
    const ch = await client.channels.fetch(id);
    if (ch && ch.isTextBased()) return ch as TextChannel;
    console.error(`[monitor] ${label} is not a text channel`);
  } catch (err) {
    console.error(`[monitor] cannot fetch ${label}:`, (err as Error).message);
  }
  return null;
}

async function renderDashboard(channel: TextChannel, container: ContainerBuilder): Promise<void> {
  const existingId = getDashboardMessageId();
  if (existingId) {
    try {
      const msg = await channel.messages.fetch(existingId);
      await msg.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    } catch {
      // ข้อความเดิมหาย/เป็น embed เก่าแก้ไม่ได้ → สร้างใหม่
    }
  }
  const msg = await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
  setDashboardMessageId(msg.id);
  msg.pin().catch(() => {}); // pin ไว้บนสุด ถ้าทำไม่ได้ก็ข้าม
}

async function scan(client: Client): Promise<void> {
  let servers: ServerRow[] = [];
  let online: Map<string, number> = new Map();
  try {
    [servers, online] = await Promise.all([getAllServers(), getOnlineCountsByServer()]);
  } catch (err) {
    console.warn("[monitor] db query failed (continuing without db):", (err as Error).message);
  }

  // dashboard = ช่องสาธารณะ (ทุกคนเห็น) / event = ช่องแอดมิน (ตั้งสิทธิ์ใน Discord)
  const dashboardChannel = await fetchTextChannel(client, config.discord.alertChannelId, "ALERT_CHANNEL_ID");
  const eventChannel = await fetchTextChannel(client, config.discord.eventChannelId, "EVENT_CHANNEL_ID");

  const sendEvent = (container: ContainerBuilder) =>
    eventChannel
      ?.send({ components: [container], flags: MessageFlags.IsComponentsV2 })
      .catch((e) => console.error("[monitor] event send failed:", e.message));

  // 1) Dashboard online/offline — edit ข้อความเดียว (Components V2) ในช่องสาธารณะ
  if (dashboardChannel) {
    await renderDashboard(dashboardChannel, buildDashboardContainer(servers, online)).catch((e) =>
      console.error("[monitor] dashboard render failed:", e.message)
    );
  }

  // 1.5) Service Status panels — แยกข้อความ (SIRU-SKIN + FiguraCloud + Node Status + Cloudflare)
  await renderServicePanel(client).catch((e) => console.error("[monitor] service panel failed:", e.message));
  await renderFiguraPanel(client).catch((e) => console.error("[monitor] figura panel failed:", e.message));
  await renderNodeStatusPanel(client).catch((e) => console.error("[monitor] node status panel failed:", e.message));
  await renderCloudflarePanel(client).catch((e) => console.error("[monitor] cloudflare panel failed:", e.message));

  // 2) Event alerts — โพสต์แยกในช่องแอดมิน (activation / IP change / expiry)
  for (const server of servers) {
    const prev = getServerState(server.id);
    const expired = new Date(server.expiresAt).getTime() < Date.now();
    const personal = isPersonal(server.plan);
    const firstSeen = !prev?.known;

    const next: ServerState = {
      lastSeenIp: server.lastSeenIp,
      isActive: server.isActive,
      expiryWarned: prev?.expiryWarned ?? [],
      known: true,
    };

    if (!firstSeen && !personal) {
      // Activation: false -> true
      if (prev!.isActive === false && server.isActive === true) {
        await sendEvent(buildEventContainer("activated", server));
      }
      // IP change
      if (prev!.lastSeenIp && server.lastSeenIp && prev!.lastSeenIp !== server.lastSeenIp) {
        await sendEvent(
          buildEventContainer("ip-change", server, { "IP เดิม": prev!.lastSeenIp, "IP ใหม่": server.lastSeenIp })
        );
      }
    }

    // Expiry warning — ทุก plan
    if (!expired) {
      const left = daysLeft(server.expiresAt);
      const maxWarn = Math.max(...config.monitor.expiryWarnDays);
      if (left > maxWarn) {
        next.expiryWarned = [];
      } else {
        for (const warnDay of [...config.monitor.expiryWarnDays].sort((a, b) => b - a)) {
          if (left <= warnDay && left > 0 && !next.expiryWarned.includes(warnDay)) {
            await sendEvent(
              buildEventContainer("expiry", server, { เหลือ: `${left} วัน`, หมดอายุ: ts(server.expiresAt, "f") })
            );
            next.expiryWarned = [...next.expiryWarned, warnDay];
          }
        }
      }
    }

    setServerState(server.id, next);
  }
}

export function startMonitor(client: Client): void {
  if (!cron.validate(config.monitor.cron)) {
    throw new Error(`Invalid MONITOR_CRON: ${config.monitor.cron}`);
  }
  console.log(`[monitor] scheduling scan: ${config.monitor.cron}`);
  scan(client).catch((e) => console.error("[monitor] initial scan error:", e.message));
  cron.schedule(config.monitor.cron, () => {
    scan(client).catch((e) => console.error("[monitor] scan error:", e.message));
  });
}
