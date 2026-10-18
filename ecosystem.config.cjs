// PM2 config — รัน bot 24/7 บน VPS พร้อม auto-restart
// ใช้งาน:
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup   (ให้ขึ้นเองตอน boot)
//   pm2 logs siru-skin-bot
module.exports = {
  apps: [
    {
      name: "siru-skin-bot",
      script: "./dist/index.js",
      interpreter: "node",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
