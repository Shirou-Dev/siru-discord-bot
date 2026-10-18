import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// State store แบบไฟล์ JSON — ใช้กันการแจ้งเตือนซ้ำ (A) และเก็บใบสมัคร sponsor (D)
// อยู่ฝั่ง bot ล้วน ไม่แตะ schema ของ backend

const STATE_PATH = "./data/state.json";

export interface ServerState {
  lastSeenIp: string | null;
  isActive: boolean;
  // วันที่เตือนใกล้หมดอายุไปแล้ว (bucket = จำนวนวันก่อนหมด) กันเตือนซ้ำ
  expiryWarned: number[];
  known: boolean; // เคยเห็น server นี้แล้วหรือยัง (กันแจ้ง activation ตอน bot เพิ่งสตาร์ท)
}

export interface SponsorApp {
  serverId: string;
  serverName: string;
  applicantId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
}

interface StateShape {
  servers: Record<string, ServerState>;
  sponsorApps: Record<string, SponsorApp>; // key = review message id
  dashboardMessageId?: string; // ข้อความ dashboard สถานะ online/offline ที่ edit ซ้ำ
  serviceMessageId?: string; // ข้อความ panel Service Status ที่ edit ซ้ำ
  figuraMessageId?: string; // ข้อความ panel Figura Service Status ที่ edit ซ้ำ
  nodeStatusMessageId?: string; // ข้อความ panel Cluster Node Status ที่ edit ซ้ำ
  cloudflareMessageId?: string; // ข้อความ panel Cloudflare Status ที่ edit ซ้ำ
  lastCloudflareIndicator?: string;
  warnedCloudflareIncidents?: string[];
}

let state: StateShape = { servers: {}, sponsorApps: {} };

export function loadState(): void {
  try {
    if (existsSync(STATE_PATH)) {
      state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
      state.servers ??= {};
      state.sponsorApps ??= {};
    }
  } catch (err) {
    console.error("[store] failed to load state, starting fresh:", (err as Error).message);
    state = { servers: {}, sponsorApps: {} };
  }
}

let saveTimer: NodeJS.Timeout | null = null;
function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(dirname(STATE_PATH), { recursive: true });
      writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error("[store] failed to save state:", (err as Error).message);
    }
  }, 500);
}

export function getDashboardMessageId(): string | undefined {
  return state.dashboardMessageId;
}

export function setDashboardMessageId(id: string): void {
  state.dashboardMessageId = id;
  scheduleSave();
}

export function getServiceMessageId(): string | undefined {
  return state.serviceMessageId;
}

export function setServiceMessageId(id: string): void {
  state.serviceMessageId = id;
  scheduleSave();
}

export function getFiguraMessageId(): string | undefined {
  return state.figuraMessageId;
}

export function setFiguraMessageId(id: string): void {
  state.figuraMessageId = id;
  scheduleSave();
}

export function getNodeStatusMessageId(): string | undefined {
  return state.nodeStatusMessageId;
}

export function setNodeStatusMessageId(id: string): void {
  state.nodeStatusMessageId = id;
  scheduleSave();
}

export function getCloudflareMessageId(): string | undefined {
  return state.cloudflareMessageId;
}

export function setCloudflareMessageId(id: string): void {
  state.cloudflareMessageId = id;
  scheduleSave();
}

export function getLastCloudflareIndicator(): string | undefined {
  return state.lastCloudflareIndicator;
}

export function setLastCloudflareIndicator(indicator: string): void {
  state.lastCloudflareIndicator = indicator;
  scheduleSave();
}

export function isCloudflareIncidentWarned(id: string): boolean {
  return state.warnedCloudflareIncidents?.includes(id) ?? false;
}

export function addWarnedCloudflareIncident(id: string): void {
  state.warnedCloudflareIncidents ??= [];
  if (!state.warnedCloudflareIncidents.includes(id)) {
    state.warnedCloudflareIncidents.push(id);
    scheduleSave();
  }
}

export function getServerState(id: string): ServerState | undefined {
  return state.servers[id];
}

export function setServerState(id: string, s: ServerState): void {
  state.servers[id] = s;
  scheduleSave();
}

export function addSponsorApp(messageId: string, app: SponsorApp): void {
  state.sponsorApps[messageId] = app;
  scheduleSave();
}

export function getSponsorApp(messageId: string): SponsorApp | undefined {
  return state.sponsorApps[messageId];
}

export function updateSponsorAppStatus(messageId: string, status: SponsorApp["status"]): void {
  const app = state.sponsorApps[messageId];
  if (app) {
    app.status = status;
    scheduleSave();
  }
}

/** มีใบสมัคร PENDING ของ server นี้ค้างอยู่ไหม (กันสมัครซ้ำ) */
export function hasPendingAppForServer(serverId: string): boolean {
  return Object.values(state.sponsorApps).some(
    (a) => a.serverId === serverId && a.status === "PENDING"
  );
}
