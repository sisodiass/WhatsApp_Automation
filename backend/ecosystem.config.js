// PM2 ecosystem — final 3-process topology.
//
//   sa-api        ← HTTP + Socket.io
//   sa-wa-worker  ← whatsapp-web.js + Chromium (single process per number)
//   sa-worker     ← all BullMQ queues + scheduler (watchdog, backups)
//
// Operational tuning:
//   - max_restarts + min_uptime: PM2 gives up if a process crashes 10x in
//     the first 60s — usually a config/migration error. Otherwise it
//     restarts forever with exponential backoff (PM2 default).
//   - kill_timeout: how long PM2 waits for a process to exit cleanly after
//     SIGINT before SIGKILL. The wa-worker needs longer (Puppeteer).
//   - max_memory_restart: forces a restart if RSS climbs past the cap —
//     the safety net for memory leaks (notably in Chromium).
//   - log_date_format: structured logs already include timestamps via
//     winston, but PM2 prepends one too for non-JSON lines.
//
// Production logging: pair with `pm2-logrotate`:
//   pm2 install pm2-logrotate
//   pm2 set pm2-logrotate:max_size 50M
//   pm2 set pm2-logrotate:retain 30
//   pm2 set pm2-logrotate:compress true

const COMMON = {
  cwd: __dirname,
  exec_mode: "fork",
  instances: 1,
  env_production: { NODE_ENV: "production" },
  max_restarts: 10,
  min_uptime: "60s",
  restart_delay: 2000,
  log_date_format: "YYYY-MM-DD HH:mm:ss",
  merge_logs: true,
  time: true,
};

module.exports = {
  apps: [
    {
      ...COMMON,
      name: "sa-api",
      script: "src/index.js",
      max_memory_restart: "500M",
      kill_timeout: 10_000,
      out_file: "./logs/api.out.log",
      error_file: "./logs/api.err.log",
    },
    {
      ...COMMON,
      name: "sa-wa-worker",
      script: "src/workers/whatsapp.worker.js",
      max_memory_restart: "800M",
      // Puppeteer needs more time to gracefully shut down its Chromium child.
      kill_timeout: 20_000,
      out_file: "./logs/wa.out.log",
      error_file: "./logs/wa.err.log",
    },
    {
      ...COMMON,
      name: "sa-worker",
      script: "src/workers/index.js",
      max_memory_restart: "500M",
      kill_timeout: 15_000,
      out_file: "./logs/worker.out.log",
      error_file: "./logs/worker.err.log",
    },
  ],
};
