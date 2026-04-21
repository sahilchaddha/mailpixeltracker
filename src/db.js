const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createDatabase(dbPath) {
  ensureParentDirectory(dbPath);
  const db = new sqlite3.Database(dbPath);

  db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON");
    db.run(`
      CREATE TABLE IF NOT EXISTS trackers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('mail', 'link')),
        target_url TEXT,
        pixel_filename TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tracker_id INTEGER NOT NULL,
        event_type TEXT NOT NULL CHECK (event_type IN ('open', 'click')),
        ip_address TEXT,
        user_agent TEXT,
        referer TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (tracker_id) REFERENCES trackers(id) ON DELETE CASCADE
      )
    `);
    db.run("CREATE INDEX IF NOT EXISTS idx_trackers_uuid ON trackers(uuid)");
    db.run("CREATE INDEX IF NOT EXISTS idx_events_tracker_id ON events(tracker_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC)");
  });

  return db;
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        lastID: this.lastID,
        changes: this.changes,
      });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(row);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows);
    });
  });
}

module.exports = {
  all,
  createDatabase,
  get,
  run,
};
