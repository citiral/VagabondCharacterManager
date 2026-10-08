// Login, registration, and the approval page. Kept out of the character sheet.

import { esc } from "../public/html.js";
import type { AccountPublic } from "./store.ts";

export function loginPage(message = "", tone: "error" | "note" = "error") {
  return document("Sign in", `
    ${note(message, tone)}
    <form method="post" action="/login">
      <label class="field">Email
        <input name="email" type="email" autocomplete="username" required>
      </label>
      <label class="field">Password
        <input name="password" type="password" autocomplete="current-password" required>
      </label>
      <button class="primary" type="submit">Sign in</button>
    </form>
    <p class="gate-links"><a href="/register">Create an account</a></p>
  `);
}

export function registerPage(message = "", options: { error?: boolean; done?: boolean } = {}) {
  const tone = options.error ? "error" : "note";
  return document("Create an account", `
    ${note(message, tone)}
    ${options.done ? "" : `
      <form method="post" action="/register">
        <label class="field">Username
          <input name="username" type="text" autocomplete="nickname" minlength="2" maxlength="24" required>
        </label>
        <label class="field">Email
          <input name="email" type="email" autocomplete="username" required>
        </label>
        <label class="field">Password
          <input name="password" type="password" autocomplete="new-password" minlength="8" required>
        </label>
        <button class="primary" type="submit">Create account</button>
      </form>
    `}
    <p class="gate-links"><a href="/login">Sign in</a></p>
  `);
}

export function adminPage(users: AccountPublic[]) {
  const pending = users.filter((user) => user.status === "pending");
  const rejected = users.filter((user) => user.status === "rejected");
  return document("Approvals", `
    <p>New accounts stay closed until you approve them.</p>
    <h2>Waiting</h2>
    ${rows(pending, "No one is waiting.")}
    <h2>Declined</h2>
    ${rows(rejected, "No declined accounts.")}
    <p class="gate-links"><a href="/">Back to the party</a></p>
    <form method="post" action="/logout"><button class="ghost" type="submit">Sign out</button></form>
  `, true);
}

export function notFoundPage() {
  return document("Not found", `<p>Not found.</p>`);
}

export function usernamePage(message = "") {
  return document("Choose a username", `
    ${note(message, "error")}
    <p>This is the name shown in the app.</p>
    <form method="post" action="/username">
      <label class="field">Username
        <input name="username" type="text" autocomplete="nickname" minlength="2" maxlength="24" required>
      </label>
      <button class="primary" type="submit">Save</button>
    </form>
  `);
}

function rows(users: AccountPublic[], empty: string) {
  if (!users.length) return `<p>${esc(empty)}</p>`;
  return `<ul class="review">${users.map((user) => `
    <li>
      <div>
        <strong>${esc(user.username || user.email)}</strong>
        <small>${user.username ? `${esc(user.email)} · ` : ""}${esc(when(user.createdAt))}</small>
      </div>
      <div class="review-actions">
        <form method="post" action="/admin/users/${esc(user.id)}/approve"><button class="primary" type="submit">Approve</button></form>
        <form method="post" action="/admin/users/${esc(user.id)}/reject"><button class="danger" type="submit">Reject</button></form>
      </div>
    </li>
  `).join("")}</ul>`;
}

function note(message: string, tone: "error" | "note") {
  if (!message) return "";
  return `<p class="gate-msg ${tone}">${esc(message)}</p>`;
}

function when(ms: number) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function document(title: string, body: string, wide = false) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · Vagabond</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,650&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="gate">
  <main class="gate-wrap">
    <section class="gate-card${wide ? " wide" : ""}">
      <p class="kicker">Land of the Blind</p>
      <h1 class="brand">VAGA<span>BOND</span></h1>
      ${body}
    </section>
  </main>
</body>
</html>`;
}
