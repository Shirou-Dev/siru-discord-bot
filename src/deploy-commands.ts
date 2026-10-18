import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commands } from "./commands.js";

// ลงทะเบียน slash commands แบบ guild (เห็นผลทันที)
// รันด้วย: npm run deploy-commands  (index.ts ก็เรียก deployCommands() ให้อัตโนมัติตอนสตาร์ท)
export async function deployCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discord.token);
  await rest.put(
    Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
    { body: commands }
  );
  console.log(`[deploy] registered ${commands.length} guild commands`);
}

// ถ้ารันไฟล์นี้ตรงๆ ให้ deploy แล้วจบ
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("deploy-commands.ts")) {
  deployCommands()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[deploy] failed:", err);
      process.exit(1);
    });
}
