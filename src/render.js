function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  if (!value) {
    return "N/A";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function badgeClass(type) {
  return type === "mail" || type === "open" ? "badge badge-mail" : "badge badge-link";
}

function statusMessage(kind, message) {
  if (!message) {
    return "";
  }

  return `<div class="flash flash-${escapeHtml(kind)}">${escapeHtml(message)}</div>`;
}

function withBasePath(basePath, routePath = "/") {
  const normalizedBasePath = basePath ? `/${String(basePath).replace(/^\/+|\/+$/g, "")}` : "";
  const normalizedRoutePath = routePath.startsWith("/") ? routePath : `/${routePath}`;
  return `${normalizedBasePath}${normalizedRoutePath}`;
}

function absoluteUrl(baseUrl, basePath, routePath) {
  return `${String(baseUrl || "").replace(/\/$/, "")}${withBasePath(basePath, routePath)}`;
}

function renderLayout({
  title,
  body,
  activePath = "/",
  basePath = "",
  flash,
  user,
  hideNav = false,
}) {
  const navigation = hideNav
    ? ""
    : `
      <aside class="sidebar">
        <div>
          <div class="brand">MailPixelTracker</div>
          <p class="sidebar-copy">Track email opens and link clicks from one local dashboard.</p>
        </div>
        <nav class="nav">
          <a class="${activePath === "/" ? "active" : ""}" href="${withBasePath(basePath, "/")}">Dashboard</a>
          <a class="${activePath === "/trackers/new" ? "active" : ""}" href="${withBasePath(basePath, "/trackers/new")}">Create Tracker</a>
        </nav>
        <div class="sidebar-footer">
          <span>Signed in as ${escapeHtml(user || "admin")}</span>
          <form method="post" action="${withBasePath(basePath, "/logout")}">
            <button class="ghost-button" type="submit">Logout</button>
          </form>
        </div>
      </aside>
    `;

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${escapeHtml(title)} | MailPixelTracker</title>
      <link rel="stylesheet" href="${withBasePath(basePath, "/assets/styles.css")}" />
    </head>
    <body class="${hideNav ? "auth-shell" : "app-shell"}">
      ${navigation}
      <main class="${hideNav ? "auth-main" : "main-content"}">
        ${flash ? statusMessage(flash.type, flash.message) : ""}
        ${body}
      </main>
    </body>
  </html>`;
}

function renderLoginPage({ basePath, flash, usernameHint = "admin" }) {
  const body = `
    <section class="auth-card">
      <div>
        <span class="eyebrow">Secure Access</span>
        <h1>MailPixelTracker</h1>
        <p>Sign in to manage pixel trackers, redirect links, and real-time open alerts.</p>
      </div>
      <form class="stack-form" method="post" action="${withBasePath(basePath, "/login")}">
        <label>
          Username
          <input name="username" type="text" value="${escapeHtml(usernameHint)}" autocomplete="username" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autocomplete="current-password" required />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </section>
  `;

  return renderLayout({
    title: "Login",
    body,
    basePath,
    flash,
    hideNav: true,
  });
}

function renderDashboard({ stats, trackers, recentEvents, basePath, baseUrl, flash, user }) {
  const trackerRows = trackers.length
    ? trackers
        .map(
          (tracker) => `
            <tr>
              <td>
                <a href="${withBasePath(basePath, `/trackers/${escapeHtml(tracker.uuid)}`)}">${escapeHtml(tracker.name)}</a>
                <div class="muted">${escapeHtml(tracker.uuid)}</div>
              </td>
              <td><span class="${badgeClass(tracker.type)}">${escapeHtml(tracker.type)}</span></td>
              <td>${
                tracker.type === "mail"
                  ? escapeHtml(absoluteUrl(baseUrl, basePath, `/${tracker.uuid}/signature.png`))
                  : escapeHtml(absoluteUrl(baseUrl, basePath, `/r/${tracker.uuid}`))
              }</td>
              <td>${escapeHtml(String(tracker.event_count || 0))}</td>
              <td>${formatDate(tracker.last_event_at || tracker.created_at)}</td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="5" class="empty-state-cell">No trackers yet. Create one to start logging opens and clicks.</td></tr>`;

  const eventRows = recentEvents.length
    ? recentEvents
        .map(
          (event) => `
            <tr>
              <td>${formatDate(event.created_at)}</td>
              <td><span class="${badgeClass(event.event_type)}">${escapeHtml(event.event_type)}</span></td>
              <td><a href="${withBasePath(basePath, `/trackers/${escapeHtml(event.uuid)}`)}">${escapeHtml(event.tracker_name)}</a></td>
              <td>${escapeHtml(event.ip_address || "Unknown")}</td>
              <td class="wrap-cell">${escapeHtml(event.user_agent || "Unknown")}</td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="5" class="empty-state-cell">No opens or clicks logged yet.</td></tr>`;

  const body = `
    <section class="hero">
      <div>
        <span class="eyebrow">Operations Console</span>
        <h1>Email open and link click tracking</h1>
        <p>Create trackers, drop the generated image URL into Gmail, or share redirect URLs that log activity before forwarding.</p>
      </div>
      <a class="button-link" href="${withBasePath(basePath, "/trackers/new")}">Create Tracker</a>
    </section>

    <section class="stats-grid">
      <article class="stat-card">
        <span>Total Trackers</span>
        <strong>${escapeHtml(String(stats.totalTrackers || 0))}</strong>
      </article>
      <article class="stat-card">
        <span>Mail Trackers</span>
        <strong>${escapeHtml(String(stats.mailTrackers || 0))}</strong>
      </article>
      <article class="stat-card">
        <span>Link Trackers</span>
        <strong>${escapeHtml(String(stats.linkTrackers || 0))}</strong>
      </article>
      <article class="stat-card">
        <span>Total Events</span>
        <strong>${escapeHtml(String(stats.totalEvents || 0))}</strong>
      </article>
    </section>

    <section class="panel">
      <div class="panel-heading">
        <h2>Trackers</h2>
        <span>${escapeHtml(baseUrl)}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Tracking URL</th>
              <th>Events</th>
              <th>Last Activity</th>
            </tr>
          </thead>
          <tbody>${trackerRows}</tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-heading">
        <h2>Recent Activity</h2>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>Tracker</th>
              <th>IP</th>
              <th>User Agent</th>
            </tr>
          </thead>
          <tbody>${eventRows}</tbody>
        </table>
      </div>
    </section>
  `;

  return renderLayout({
    title: "Dashboard",
    body,
    activePath: "/",
    basePath,
    flash,
    user,
  });
}

function renderNewTrackerPage({ basePath, flash, user }) {
  const body = `
    <section class="hero compact">
      <div>
        <span class="eyebrow">Create Tracker</span>
        <h1>Choose the tracking mode</h1>
        <p>Mail trackers return an image for email opens. Link trackers log a click and redirect to your target URL.</p>
      </div>
    </section>

    <section class="create-grid">
      <article class="panel">
        <div class="panel-heading">
          <h2>Mail Tracker</h2>
        </div>
        <form class="stack-form" action="${withBasePath(basePath, "/trackers/mail")}" method="post" enctype="multipart/form-data">
          <label>
            Tracker name
            <input name="name" type="text" placeholder="April outbound sequence" required />
          </label>
          <label>
            Custom pixel image
            <input name="pixelImage" type="file" accept="image/png,image/gif,image/jpeg,image/webp" />
          </label>
          <p class="hint">Optional. If omitted, the tracker serves a 1x1 transparent PNG.</p>
          <button type="submit">Create Mail Tracker</button>
        </form>
      </article>

      <article class="panel">
        <div class="panel-heading">
          <h2>Link Tracker</h2>
        </div>
        <form class="stack-form" action="${withBasePath(basePath, "/trackers/link")}" method="post">
          <label>
            Tracker name
            <input name="name" type="text" placeholder="Pricing CTA" required />
          </label>
          <label>
            Redirect URL
            <input name="targetUrl" type="url" placeholder="https://example.com/pricing" required />
          </label>
          <button type="submit">Create Link Tracker</button>
        </form>
      </article>
    </section>
  `;

  return renderLayout({
    title: "Create Tracker",
    body,
    activePath: "/trackers/new",
    basePath,
    flash,
    user,
  });
}

function renderTrackerDetailPage({ tracker, events, basePath, baseUrl, flash, user }) {
  const trackingUrl =
    tracker.type === "mail"
      ? absoluteUrl(baseUrl, basePath, `/${tracker.uuid}/signature.png`)
      : absoluteUrl(baseUrl, basePath, `/r/${tracker.uuid}`);

  const usageExample =
    tracker.type === "mail"
      ? `&lt;img src="${escapeHtml(trackingUrl)}" width="1" height="1" alt="" style="display:block;border:0;outline:none;text-decoration:none;" /&gt;`
      : `${escapeHtml(trackingUrl)}`;

  const eventRows = events.length
    ? events
        .map(
          (event) => `
            <tr>
              <td>${formatDate(event.created_at)}</td>
              <td>${escapeHtml(event.ip_address || "Unknown")}</td>
              <td class="wrap-cell">${escapeHtml(event.user_agent || "Unknown")}</td>
              <td>${escapeHtml(event.referer || "Direct / hidden")}</td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="4" class="empty-state-cell">No activity logged for this tracker yet.</td></tr>`;

  const body = `
    <section class="hero compact">
      <div>
        <span class="eyebrow">${escapeHtml(tracker.type)} tracker</span>
        <h1>${escapeHtml(tracker.name)}</h1>
        <p>Created ${formatDate(tracker.created_at)}. UUID: ${escapeHtml(tracker.uuid)}</p>
      </div>
      <div class="hero-actions">
        <a class="button-link secondary" href="${withBasePath(basePath, "/")}">Back to Dashboard</a>
        <form
          method="post"
          action="${withBasePath(basePath, `/trackers/${escapeHtml(tracker.uuid)}/delete`)}"
          onsubmit="return confirm('Delete this tracker and all of its events? This cannot be undone.');"
        >
          <button class="danger-button" type="submit">Delete Tracker</button>
        </form>
      </div>
    </section>

    <section class="details-grid">
      <article class="panel">
        <div class="panel-heading">
          <h2>Tracking URL</h2>
        </div>
        <code class="code-block">${escapeHtml(trackingUrl)}</code>
        ${
          tracker.type === "link"
            ? `<p class="hint">Redirect target: ${escapeHtml(tracker.target_url || "")}</p>`
            : `<p class="hint">Custom image: ${escapeHtml(tracker.pixel_filename || "Default transparent pixel")}</p>`
        }
      </article>
      <article class="panel">
        <div class="panel-heading">
          <h2>Usage</h2>
        </div>
        <code class="code-block">${usageExample}</code>
      </article>
    </section>

    <section class="panel">
      <div class="panel-heading">
        <h2>Event History</h2>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>IP</th>
              <th>User Agent</th>
              <th>Referer</th>
            </tr>
          </thead>
          <tbody>${eventRows}</tbody>
        </table>
      </div>
    </section>
  `;

  return renderLayout({
    title: tracker.name,
    body,
    activePath: "/",
    basePath,
    flash,
    user,
  });
}

module.exports = {
  escapeHtml,
  formatDate,
  renderDashboard,
  renderLayout,
  renderLoginPage,
  renderNewTrackerPage,
  renderTrackerDetailPage,
};
