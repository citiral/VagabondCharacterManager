// Boots the hero record: wire the buttons, keep the socket alive, load the party.

import "./actions.js";
import { esc } from "./html.js";
import { app } from "./state.js";
import { installLifecycle, load } from "./sync.js";

installLifecycle();

load().catch((error) => {
  app.innerHTML = `<p class="banner">${esc(error.message)}</p>`;
});
