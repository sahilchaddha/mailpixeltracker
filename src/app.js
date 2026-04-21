const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const dotenv = require("dotenv");
const { all, createDatabase, get, run } = require("./db");
const {
  renderDashboard,
  renderLoginPage,
  renderNewTrackerPage,
  renderTrackerDetailPage,
} = require("./render");

dotenv.config();

const transparentPixelBuffer = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9l9OQAAAAASUVORK5CYII=",
  "base64",
);

function setFlash(request, type, message) {
  request.session.flash = { type, message };
}

function consumeFlash(request) {
  const flash = request.session.flash;
  delete request.session.flash;
  return flash;
}

function getBaseUrl(request) {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/$/, "");
  }

  const forwardedProto = request.get("x-forwarded-proto");
  const protocol = forwardedProto ? forwardedProto.split(",")[0].trim() : request.protocol;
  return `${protocol}://${request.get("host")}`;
}

function normalizeBasePath(value) {
  const trimmedValue = String(value || "").trim();
  if (!trimmedValue || trimmedValue === "/") {
    return "";
  }

  return `/${trimmedValue.replace(/^\/+|\/+$/g, "")}`;
}

function getBasePath(request) {
  if (process.env.APP_BASE_PATH) {
    return normalizeBasePath(process.env.APP_BASE_PATH);
  }

  if (process.env.APP_BASE_URL) {
    try {
      return normalizeBasePath(new URL(process.env.APP_BASE_URL).pathname);
    } catch (_error) {
      return "";
    }
  }

  const forwardedPrefix = request.get("x-forwarded-prefix");
  if (forwardedPrefix) {
    return normalizeBasePath(forwardedPrefix.split(",")[0].trim());
  }

  return "";
}

function withBasePath(request, routePath) {
  const normalizedRoutePath = routePath.startsWith("/") ? routePath : `/${routePath}`;
  return `${getBasePath(request)}${normalizedRoutePath}`;
}

function getClientIp(request) {
  const forwarded = request.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  return request.ip || request.socket?.remoteAddress || "unknown";
}

function removePixelFile(pixelDirectory, filename) {
  if (!filename) {
    return;
  }

  const filePath = path.join(pixelDirectory, filename);
  if (!fs.existsSync(filePath)) {
    return;
  }

  fs.unlinkSync(filePath);
}

async function sendTelegramAlert(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error("Telegram alert failed:", response.status, body);
    }
  } catch (error) {
    console.error("Telegram alert failed:", error.message);
  }
}

async function recordEvent(request, tracker, eventType, db) {
  const ipAddress = getClientIp(request);
  const userAgent = request.get("user-agent") || "unknown";
  const referer = request.get("referer") || "";

  await run(
    db,
    `
      INSERT INTO events (tracker_id, event_type, ip_address, user_agent, referer)
      VALUES (?, ?, ?, ?, ?)
    `,
    [tracker.id, eventType, ipAddress, userAgent, referer],
  );

  const trackingUrl =
    tracker.type === "mail"
      ? `${getBaseUrl(request)}${withBasePath(request, `/${tracker.uuid}/signature.png`)}`
      : `${getBaseUrl(request)}${withBasePath(request, `/r/${tracker.uuid}`)}`;

  const message = [
    `MailPixelTracker ${eventType.toUpperCase()}`,
    `Tracker: ${tracker.name}`,
    `Type: ${tracker.type}`,
    `UUID: ${tracker.uuid}`,
    `Time: ${new Date().toISOString()}`,
    `IP: ${ipAddress}`,
    `User-Agent: ${userAgent}`,
    `URL: ${trackingUrl}`,
  ].join("\n");

  await sendTelegramAlert(message);
}

function requireAuth(request, response, next) {
  if (request.session.isAuthenticated) {
    next();
    return;
  }

  if (request.path === "/login" || request.path === "/logout") {
    next();
    return;
  }

  response.redirect(withBasePath(request, "/login"));
}

function createApp() {
  const app = express();
  app.set("trust proxy", true);

  const databasePath = path.resolve(process.cwd(), process.env.DB_PATH || "./data/mailpixeltracker.db");
  const pixelDirectory = path.resolve(process.cwd(), process.env.PIXEL_STORAGE_DIR || "./data/pixels");
  fs.mkdirSync(pixelDirectory, { recursive: true });

  const db = createDatabase(databasePath);
  const adminUsername = process.env.APP_USERNAME || process.env.BASIC_AUTH_USER || "admin";
  const adminPassword = process.env.APP_PASSWORD || process.env.BASIC_AUTH_PASS || "changeme";
  const sessionSecret = process.env.SESSION_SECRET || "change-this-session-secret";

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_request, _file, callback) => {
        callback(null, pixelDirectory);
      },
      filename: (_request, file, callback) => {
        const extension = path.extname(file.originalname || "").toLowerCase() || ".png";
        callback(null, `${crypto.randomUUID()}${extension}`);
      },
    }),
    fileFilter: (_request, file, callback) => {
      if (!file.mimetype.startsWith("image/")) {
        callback(new Error("Only image uploads are allowed."));
        return;
      }

      callback(null, true);
    },
    limits: {
      fileSize: 1024 * 1024 * 2,
    },
  });

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 1000 * 60 * 60,
        httpOnly: true,
        sameSite: "lax",
        secure: false,
      },
    }),
  );

  app.use(express.urlencoded({ extended: true }));
  app.use("/assets", express.static(path.resolve(process.cwd(), "public")));

  app.get("/:uuid/signature.png", async (request, response, next) => {
    try {
      const tracker = await get(db, "SELECT * FROM trackers WHERE uuid = ? AND type = 'mail'", [request.params.uuid]);
      if (!tracker) {
        response.status(404).type("text/plain").send("Tracker not found");
        return;
      }

      await recordEvent(request, tracker, "open", db);

      if (tracker.pixel_filename) {
        const filePath = path.join(pixelDirectory, tracker.pixel_filename);
        if (fs.existsSync(filePath)) {
          response.sendFile(filePath);
          return;
        }
      }

      response.set("Content-Type", "image/png");
      response.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      response.send(transparentPixelBuffer);
    } catch (error) {
      next(error);
    }
  });

  app.get("/r/:uuid", async (request, response, next) => {
    try {
      const tracker = await get(db, "SELECT * FROM trackers WHERE uuid = ? AND type = 'link'", [request.params.uuid]);
      if (!tracker) {
        response.status(404).type("text/plain").send("Tracker not found");
        return;
      }

      await recordEvent(request, tracker, "click", db);
      response.redirect(tracker.target_url);
    } catch (error) {
      next(error);
    }
  });

  app.use(requireAuth);

  app.get("/login", (request, response) => {
    if (request.session.isAuthenticated) {
      response.redirect(withBasePath(request, "/"));
      return;
    }

    response.send(
      renderLoginPage({
        basePath: getBasePath(request),
        flash: consumeFlash(request),
        usernameHint: adminUsername,
      }),
    );
  });

  app.post("/login", (request, response) => {
    const username = String(request.body.username || "");
    const password = String(request.body.password || "");

    if (username === adminUsername && password === adminPassword) {
      request.session.isAuthenticated = true;
      request.session.username = username;
      setFlash(request, "success", "Signed in successfully.");
      response.redirect(withBasePath(request, "/"));
      return;
    }

    setFlash(request, "error", "Invalid username or password.");
    response.redirect(withBasePath(request, "/login"));
  });

  app.post("/logout", (request, response) => {
    request.session.destroy(() => {
      response.redirect(withBasePath(request, "/login"));
    });
  });

  app.get("/", async (request, response, next) => {
    try {
      const [stats, trackers, recentEvents] = await Promise.all([
        get(
          db,
          `
          SELECT
            COUNT(*) AS totalTrackers,
            SUM(CASE WHEN type = 'mail' THEN 1 ELSE 0 END) AS mailTrackers,
            SUM(CASE WHEN type = 'link' THEN 1 ELSE 0 END) AS linkTrackers,
            (SELECT COUNT(*) FROM events) AS totalEvents
          FROM trackers
          `,
        ),
        all(
          db,
          `
          SELECT
            t.*,
            COUNT(e.id) AS event_count,
            MAX(e.created_at) AS last_event_at
          FROM trackers t
          LEFT JOIN events e ON e.tracker_id = t.id
          GROUP BY t.id
          ORDER BY t.created_at DESC
          `,
        ),
        all(
          db,
          `
          SELECT
            e.*,
            t.name AS tracker_name,
            t.uuid AS uuid
          FROM events e
          INNER JOIN trackers t ON t.id = e.tracker_id
          ORDER BY e.created_at DESC
          LIMIT 20
          `,
        ),
      ]);

      response.send(
        renderDashboard({
          stats: {
            totalTrackers: stats?.totalTrackers || 0,
            mailTrackers: stats?.mailTrackers || 0,
            linkTrackers: stats?.linkTrackers || 0,
            totalEvents: stats?.totalEvents || 0,
          },
          trackers,
          recentEvents,
          basePath: getBasePath(request),
          baseUrl: getBaseUrl(request),
          flash: consumeFlash(request),
          user: request.session.username,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/trackers/new", (request, response) => {
    response.send(
      renderNewTrackerPage({
        basePath: getBasePath(request),
        flash: consumeFlash(request),
        user: request.session.username,
      }),
    );
  });

  app.post("/trackers/mail", upload.single("pixelImage"), async (request, response, next) => {
  try {
    const name = String(request.body.name || "").trim();
    if (!name) {
      setFlash(request, "error", "Mail tracker name is required.");
      response.redirect(withBasePath(request, "/trackers/new"));
      return;
    }

    const uuid = crypto.randomUUID();
    await run(
      db,
      `
        INSERT INTO trackers (uuid, name, type, pixel_filename)
        VALUES (?, ?, 'mail', ?)
      `,
      [uuid, name, request.file ? request.file.filename : null],
    );

    setFlash(request, "success", `Mail tracker "${name}" created.`);
    response.redirect(withBasePath(request, `/trackers/${uuid}`));
  } catch (error) {
    next(error);
  }
  });

  app.post("/trackers/link", async (request, response, next) => {
  try {
    const name = String(request.body.name || "").trim();
    const targetUrl = String(request.body.targetUrl || "").trim();
    if (!name || !targetUrl) {
      setFlash(request, "error", "Link tracker name and redirect URL are required.");
      response.redirect(withBasePath(request, "/trackers/new"));
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (_error) {
      setFlash(request, "error", "Redirect URL must be a valid absolute URL.");
      response.redirect(withBasePath(request, "/trackers/new"));
      return;
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      setFlash(request, "error", "Redirect URL must use http or https.");
      response.redirect(withBasePath(request, "/trackers/new"));
      return;
    }

    const uuid = crypto.randomUUID();
    await run(
      db,
      `
        INSERT INTO trackers (uuid, name, type, target_url)
        VALUES (?, ?, 'link', ?)
      `,
      [uuid, name, parsedUrl.toString()],
    );

    setFlash(request, "success", `Link tracker "${name}" created.`);
    response.redirect(withBasePath(request, `/trackers/${uuid}`));
  } catch (error) {
    next(error);
  }
  });

  app.post("/trackers/:uuid/delete", async (request, response, next) => {
  try {
    const tracker = await get(db, "SELECT * FROM trackers WHERE uuid = ?", [request.params.uuid]);
    if (!tracker) {
      setFlash(request, "error", "Tracker not found.");
      response.redirect(withBasePath(request, "/"));
      return;
    }

    removePixelFile(pixelDirectory, tracker.pixel_filename);

    await run(db, "DELETE FROM trackers WHERE id = ?", [tracker.id]);

    setFlash(request, "success", `Tracker "${tracker.name}" and its events were deleted.`);
    response.redirect(withBasePath(request, "/"));
  } catch (error) {
    next(error);
  }
  });

  app.get("/trackers/:uuid", async (request, response, next) => {
  try {
    const tracker = await get(db, "SELECT * FROM trackers WHERE uuid = ?", [request.params.uuid]);
    if (!tracker) {
      response.status(404).send("Tracker not found");
      return;
    }

    const events = await all(
      db,
      `
        SELECT *
        FROM events
        WHERE tracker_id = ?
        ORDER BY created_at DESC
      `,
      [tracker.id],
    );

    response.send(
      renderTrackerDetailPage({
        tracker,
        events,
        basePath: getBasePath(request),
        baseUrl: getBaseUrl(request),
        flash: consumeFlash(request),
        user: request.session.username,
      }),
    );
  } catch (error) {
    next(error);
  }
  });

  app.use((error, request, response, _next) => {
  console.error(error);

  if (request.file?.path && fs.existsSync(request.file.path)) {
    fs.unlinkSync(request.file.path);
  }

  response.status(500).send(`
    <h1>Server error</h1>
    <p>${error.message}</p>
    <p><a href="${withBasePath(request, "/")}">Return to dashboard</a></p>
  `);
  });

  return app;
}

function startServer() {
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  const app = createApp();
  return app.listen(port, () => {
    console.log(`MailPixelTracker running at http://localhost:${port}`);
  });
}

module.exports = {
  createApp,
  startServer,
};
