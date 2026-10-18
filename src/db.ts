import pkg from "pg";
import { config } from "./config.js";

const { Pool, types } = pkg;

// Backend (Prisma) เก็บ DateTime เป็น `timestamp without time zone` ที่เป็นค่า UTC จริงๆ
// แต่ node-pg ดีฟอลต์จะ parse type นี้ด้วย timezone ของเครื่อง bot ทำให้เวลาเพี้ยน
// (เช่น ICT/UTC+7 → heartbeat ดูเก่าไป 7 ชม. → แจ้ง offline ผิด)
// บังคับให้ parse OID 1114 เป็น UTC เพื่อให้ตรงกับ Prisma
types.setTypeParser(1114, (str) => new Date(str.replace(" ", "T") + "Z"));

// Pool ต่อ Postgres ตัวเดียวกับ backend SIRU-SKIN
// อ่านเป็นหลัก เขียนเฉพาะตอนอนุมัติ sponsor (updateServerSponsor)
const pool = config.databaseUrl ? new Pool({ connectionString: config.databaseUrl, max: 5 }) : null;

if (pool) {
  pool.on("error", (err) => {
    console.error("[db] unexpected pool error:", err.message);
  });
}

export interface ServerRow {
  id: string;
  name: string;
  plan: string;
  isActive: boolean;
  lastHeartbeat: Date | null;
  lastSeenIp: string | null;
  expiresAt: Date;
  autoRenew: boolean;
  isSponsored: boolean;
  sponsorNote: string | null;
  createdAt: Date;
  userId: string | null;
}

const SERVER_COLUMNS = `
  id, name, plan, "isActive", "lastHeartbeat", "lastSeenIp",
  "expiresAt", "autoRenew", "isSponsored", "sponsorNote", "createdAt", "userId"
`;

/** ดึง server ทั้งหมด (ใช้ใน monitoring loop) */
export async function getAllServers(): Promise<ServerRow[]> {
  if (!pool) return [];
  try {
    const { rows } = await pool.query<ServerRow>(`SELECT ${SERVER_COLUMNS} FROM "Server"`);
    return rows;
  } catch (err) {
    console.error("[db] getAllServers error:", (err as Error).message);
    return [];
  }
}

/** หา server จาก id ตรงตัว หรือชื่อ (case-insensitive) — ชื่อซ้ำได้ จึงคืนเป็น array */
export async function findServers(query: string): Promise<ServerRow[]> {
  if (!pool) return [];
  try {
    const { rows } = await pool.query<ServerRow>(
      `SELECT ${SERVER_COLUMNS} FROM "Server"
       WHERE id = $1 OR LOWER(name) = LOWER($1)
       ORDER BY "createdAt" DESC`,
      [query]
    );
    return rows;
  } catch (err) {
    console.error("[db] findServers error:", (err as Error).message);
    return [];
  }
}

/** นับผู้เล่นที่ออนไลน์ใน server (PlayerSession.lastPing ภายใน windowSeconds วินาที) */
export async function countOnlinePlayers(serverId: string, windowSeconds = 120): Promise<number> {
  if (!pool) return 0;
  try {
    const { rows } = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::int AS c FROM "PlayerSession"
       WHERE "serverId" = $1 AND "lastPing" > NOW() - ($2 || ' seconds')::interval`,
      [serverId, String(windowSeconds)]
    );
    return Number(rows[0]?.c ?? 0);
  } catch (err) {
    console.error("[db] countOnlinePlayers error:", (err as Error).message);
    return 0;
  }
}

/** นับผู้เล่นออนไลน์ของทุก server ในครั้งเดียว (ใช้ใน dashboard) → Map<serverId, count> */
export async function getOnlineCountsByServer(windowSeconds = 120): Promise<Map<string, number>> {
  if (!pool) return new Map();
  try {
    const { rows } = await pool.query<{ serverId: string; c: number }>(
      `SELECT "serverId", COUNT(*)::int AS c FROM "PlayerSession"
       WHERE "serverId" IS NOT NULL AND "lastPing" > NOW() - ($1 || ' seconds')::interval
       GROUP BY "serverId"`,
      [String(windowSeconds)]
    );
    return new Map(rows.map((r) => [r.serverId, Number(r.c)]));
  } catch (err) {
    console.error("[db] getOnlineCountsByServer error:", (err as Error).message);
    return new Map();
  }
}

/** อัปเดต server เป็น sponsored (เรียกตอนแอดมินกดอนุมัติ) — เลียนแบบ PATCH /admin/servers/:id */
export async function updateServerSponsor(
  serverId: string,
  opts: { note: string; expiresAt: Date }
): Promise<void> {
  if (!pool) throw new Error("Database is not connected");
  await pool.query(
    `UPDATE "Server"
     SET "isSponsored" = true,
         "autoRenew" = false,
         "sponsorNote" = $2,
         "expiresAt" = $3
     WHERE id = $1`,
    [serverId, opts.note, opts.expiresAt]
  );
}

export async function pingDb(): Promise<boolean> {
  if (!pool) return false;
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/** นับผู้เล่นที่กำลังออนไลน์รวมทุกเซิร์ฟเวอร์ (PlayerSession.lastPing ภายใน windowSeconds วินาที) */
export async function getTotalOnlinePlayers(windowSeconds = 120): Promise<number> {
  if (!pool) return 0;
  try {
    const { rows } = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::int AS c FROM "PlayerSession"
       WHERE "lastPing" > NOW() - ($1 || ' seconds')::interval`,
      [String(windowSeconds)]
    );
    return Number(rows[0]?.c ?? 0);
  } catch (err) {
    console.error("[db] getTotalOnlinePlayers error:", (err as Error).message);
    return 0;
  }
}

/** นับสกินทั้งหมดในระบบ */
export async function getTotalSkins(): Promise<number> {
  if (!pool) return 0;
  try {
    const { rows } = await pool.query<{ c: string }>(`SELECT COUNT(*)::int AS c FROM "Skin"`);
    return Number(rows[0]?.c ?? 0);
  } catch (err) {
    console.error("[db] getTotalSkins error:", (err as Error).message);
    return 0;
  }
}
