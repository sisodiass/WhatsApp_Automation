// scheduler-jobs worker. Routes by job name:
//   - "watchdog"  → wa-worker liveness check; publishes a CONTROL restart
//                   if no heartbeat. wa-worker exits on restart and PM2
//                   brings it back up. In dev (no PM2) it just exits.
//   - "backup"    → nightly pg_dump + redis BGSAVE + tar of .wwebjs_auth.
//                   Skips gracefully if binaries are missing.
//
// Repeating jobs are scheduled by `bootstrapScheduler` in workers/index.js.

import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

import { child } from "../../shared/logger.js";
import { redis } from "../../shared/redis.js";
import { Channels, publish } from "../../modules/whatsapp/whatsapp.bus.js";

const log = child("q:scheduler");
const execp = promisify(exec);

const BACKUPS_DIR = path.resolve(process.cwd(), "backups");
const RETENTION_DAYS = 7;

// Heartbeats are written to Redis by wa-worker; we read the consumer-side
// timestamp via a side-channel key (set by whatsapp.consumer's heartbeat
// handler). To keep the worker process self-contained we re-implement the
// liveness probe here: the wa-worker publishes HEARTBEAT every 15s, so we
// subscribe once and track last-seen.

let lastHeartbeatAt = null;
const sub = redis.duplicate();
sub.subscribe(Channels.HEARTBEAT).catch((err) =>
  log.warn("watchdog subscribe failed", { err: err.message }),
);
sub.on("message", () => {
  lastHeartbeatAt = Date.now();
});

export async function processSchedulerJob(job) {
  switch (job.name) {
    case "watchdog":
      return runWatchdog();
    case "backup":
      return runBackup();
    default:
      log.warn("unknown scheduler job", { name: job.name });
      return { skipped: "unknown" };
  }
}

// ─── Watchdog ───────────────────────────────────────────────────────

async function runWatchdog() {
  const now = Date.now();
  // Heartbeat is every 15s; allow 2 misses (45s) before declaring dead.
  if (lastHeartbeatAt === null) {
    log.warn("watchdog: no heartbeat seen yet (worker may still be booting)");
    return { state: "booting" };
  }
  const ageMs = now - lastHeartbeatAt;
  if (ageMs < 45_000) {
    return { state: "alive", ageMs };
  }

  log.error("watchdog: wa-worker dead, requesting restart", { ageMs });
  // Publishing CONTROL { action: "restart" } makes wa-worker call process.exit(0).
  // PM2 (production) restarts it. Dev: operator notices and re-runs `dev:wa`.
  await publish(Channels.CONTROL, { action: "restart" });

  // Don't try again for at least 60s — give the new process time to start
  // emitting heartbeats. Resetting lastHeartbeatAt prevents instant re-fire.
  lastHeartbeatAt = now;

  return { state: "restarted", ageMs };
}

// ─── Backup ─────────────────────────────────────────────────────────

async function runBackup() {
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const results = {};

  results.postgres = await runPgDump(stamp);
  results.redis = await runRedisBgsave();
  results.wwebjs = await runWwebjsTar(stamp);
  results.cleanup = await runRetentionCleanup();

  log.info("backup complete", results);
  return results;
}

async function runPgDump(stamp) {
  // Reads DATABASE_URL from env. Skips if pg_dump isn't available (dev win).
  const url = process.env.DATABASE_URL;
  if (!url) return { skipped: "no DATABASE_URL" };
  const target = path.join(BACKUPS_DIR, `pg-${stamp}.dump`);
  try {
    await execp(`pg_dump --format=custom --file="${target}" "${url}"`, {
      timeout: 5 * 60_000,
    });
    const stat = await fs.stat(target);
    return { ok: true, file: target, bytes: stat.size };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function runRedisBgsave() {
  // BGSAVE asks Redis to fork-and-save its RDB to its own dump.rdb path.
  // We don't move the file — the operator's `volumes:` mount keeps it.
  try {
    const r = await redis.bgsave();
    return { ok: true, response: r };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function runWwebjsTar(stamp) {
  const src = path.resolve(process.cwd(), ".wwebjs_auth");
  try {
    await fs.access(src);
  } catch {
    return { skipped: "no .wwebjs_auth dir" };
  }
  const target = path.join(BACKUPS_DIR, `wwebjs-${stamp}.tar.gz`);
  try {
    await execp(`tar -czf "${target}" -C "${path.dirname(src)}" "${path.basename(src)}"`, {
      timeout: 5 * 60_000,
    });
    const stat = await fs.stat(target);
    return { ok: true, file: target, bytes: stat.size };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function runRetentionCleanup() {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
    const files = await fs.readdir(BACKUPS_DIR);
    let removed = 0;
    for (const f of files) {
      const p = path.join(BACKUPS_DIR, f);
      const st = await fs.stat(p);
      if (st.mtimeMs < cutoff) {
        await fs.unlink(p);
        removed += 1;
      }
    }
    return { ok: true, removed };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
