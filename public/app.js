const STORAGE_KEY = "autaddcal_user_id";

const setup = document.getElementById("setup");
const dashboard = document.getElementById("dashboard");
const setupMessage = document.getElementById("setup-message");
const wpsForm = document.getElementById("wps-form");
const wpsBlock = document.getElementById("wps-block");
const wpsStatus = document.getElementById("wps-status");
const calendarBlock = document.getElementById("calendar-block");
const calendarSelect = document.getElementById("calendar-select");
const calendarSaveBtn = document.getElementById("calendar-save-btn");
const colorOptions = document.getElementById("color-options");
const colorSaveBtn = document.getElementById("color-save-btn");
const calendarMessage = document.getElementById("calendar-message");
const syncBtn = document.getElementById("sync-btn");
const syncStatus = document.getElementById("sync-status");
const wpsMessage = document.getElementById("wps-message");
const overviewName = document.getElementById("overview-name");
const overviewLocation = document.getElementById("overview-location");
const overviewAccount = document.getElementById("overview-account");
const overviewMeta = document.getElementById("overview-meta");
const navbar = document.getElementById("navbar");
const logoutBtn = document.getElementById("logout-btn");

let eventColors = [];
let selectedColorId = "8";

function getUserId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("user") || localStorage.getItem(STORAGE_KEY);
}

function setUserId(id) {
  localStorage.setItem(STORAGE_KEY, id);
  const url = new URL(window.location.href);
  url.searchParams.set("user", id);
  url.searchParams.delete("google");
  url.searchParams.delete("message");
  window.history.replaceState({}, "", url);
}

function clearUserId() {
  localStorage.removeItem(STORAGE_KEY);
  const url = new URL(window.location.href);
  url.searchParams.delete("user");
  window.history.replaceState({}, "", url);
}

function showSetup(message = "", isError = false) {
  setup.classList.remove("hidden");
  dashboard.classList.add("hidden");
  navbar.classList.add("hidden");
  setupMessage.textContent = message;
  setupMessage.className = isError ? "message error" : "message";
}

async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  if (!res.ok) throw new Error("User not found");
  return res.json();
}

async function waitForAutoSyncMount() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (window.mountAutoSyncToggle) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function renderAutoSyncToggle(data) {
  const root = document.getElementById("auto-sync-root");
  if (!root) return;

  const ready = await waitForAutoSyncMount();
  if (!ready || !window.mountAutoSyncToggle) return;

  const userId = getUserId();
  if (!userId) return;

  window.mountAutoSyncToggle(root, {
    userId,
    initialEnabled: data.sync.autoSyncEnabled,
    disabled: !(data.wps.connected && data.google.connected),
  });
}

function formatSyncSummary(result) {
  const parts = [];
  if (result.created) parts.push(`${result.created} added`);
  if (result.updated) parts.push(`${result.updated} updated`);
  if (result.deleted) parts.push(`${result.deleted} removed`);
  if (!parts.length) return "Calendar is up to date.";
  return parts.join(" · ");
}

function renderOverviewMeta(data) {
  const lines = [];

  if (data.google.connected && data.google.calendarName) {
    const colorName =
      eventColors.find((color) => color.id === data.google.eventColorId)?.name ||
      "Graphite";
    lines.push(`Syncs to ${data.google.calendarName} · ${colorName} events`);
  }

  if (data.sync.lastSyncAt) {
    const status =
      data.sync.lastSyncStatus === "success" ? "Successful" : data.sync.lastSyncStatus;
    lines.push(`Last sync ${data.sync.lastSyncAt} · ${status}`);
    if (data.sync.lastSyncError) {
      lines.push(data.sync.lastSyncError);
    }
  }

  overviewMeta.textContent = lines.join("\n");
  overviewMeta.classList.toggle("hidden", lines.length === 0);
}

function renderUser(data) {
  if (!data.google.connected) {
    clearUserId();
    showSetup("Your Google session expired. Sign in again.");
    return;
  }

  setup.classList.add("hidden");
  dashboard.classList.remove("hidden");
  navbar.classList.remove("hidden");

  overviewAccount.textContent = data.google.email ? `Signed in as ${data.google.email}` : "";
  overviewAccount.classList.toggle("hidden", !data.google.email);

  if (data.wps.connected) {
    wpsStatus.textContent = "Connected";
    wpsStatus.className = "badge connected";
    wpsBlock.classList.add("hidden");
    overviewName.textContent = data.wps.staffName ?? "Employee";
    overviewLocation.textContent = [
      data.wps.storeName ?? "Store",
      data.wps.employeeNumber ? `#${data.wps.employeeNumber}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    overviewLocation.classList.remove("hidden");
  } else {
    wpsStatus.textContent = "Not connected";
    wpsStatus.className = "badge";
    wpsBlock.classList.remove("hidden");
    overviewName.textContent = "Connect your schedule";
    overviewLocation.textContent = "Sign in below with your employee ID.";
    overviewLocation.classList.remove("hidden");
  }

  calendarBlock.classList.remove("hidden");
  loadCalendarPicker(data.google);

  syncBtn.disabled = !(data.wps.connected && data.google.connected);
  renderOverviewMeta(data);
  void renderAutoSyncToggle(data);
}

async function loadEventColors() {
  if (eventColors.length) return eventColors;
  const res = await fetch("/api/google/event-colors");
  const data = await res.json();
  eventColors = data.colors ?? [];
  return eventColors;
}

function renderColorOptions(selectedId = "8") {
  selectedColorId = selectedId;
  colorOptions.innerHTML = eventColors
    .map(
      (color) =>
        `<button type="button" class="color-option${color.id === selectedId ? " selected" : ""}" data-color-id="${color.id}" data-color-name="${color.name}" style="background:${color.background}" title="${color.name}" aria-label="${color.name}"></button>`,
    )
    .join("");
}

async function loadCalendarPicker(google) {
  const userId = getUserId();
  if (!userId) return;

  calendarMessage.textContent = "Loading calendars…";
  calendarMessage.className = "message";

  try {
    await loadEventColors();
    renderColorOptions(google.eventColorId || "8");

    const res = await fetch(`/api/google/${userId}/calendars`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load calendars");

    calendarSelect.innerHTML = data.calendars
      .map(
        (calendar) =>
          `<option value="${calendar.id}" data-name="${calendar.name.replace(/"/g, "&quot;")}">${calendar.name}${calendar.primary ? " (Primary)" : ""}</option>`,
      )
      .join("");

    const selectedId = google.calendarId || data.selectedCalendarId || "primary";
    calendarSelect.value = selectedId;

    const selectedName =
      google.calendarName ||
      data.calendars.find((calendar) => calendar.id === selectedId)?.name ||
      "Primary calendar";
    const colorName =
      eventColors.find((color) => color.id === (google.eventColorId || "8"))?.name ||
      "Graphite";

    calendarMessage.textContent = `${selectedName} · ${colorName}`;
    calendarMessage.className = "message success";
  } catch (error) {
    calendarMessage.textContent =
      error instanceof Error ? error.message : "Failed to load calendars";
    calendarMessage.className = "message error";
  }
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const googleError = params.get("google") === "error";
  const errorMessage = params.get("message");

  if (googleError && errorMessage) {
    showSetup(decodeURIComponent(errorMessage), true);
    return;
  }

  const userId = getUserId();
  if (!userId) {
    showSetup();
    return;
  }

  try {
    const data = await fetchUser(userId);
    setUserId(userId);
    renderUser(data);
  } catch {
    clearUserId();
    showSetup();
  }
}

wpsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const userId = getUserId();
  if (!userId) return;

  const employeeNumber = document.getElementById("employee-number").value.trim();
  const password = document.getElementById("wps-password").value;
  const btn = document.getElementById("wps-connect-btn");

  btn.disabled = true;
  wpsMessage.textContent = "Signing in (this may take a minute)…";
  wpsMessage.className = "message";

  try {
    const res = await fetch(`/auth/wps/login/${userId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeNumber, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Sign-in failed");

    wpsMessage.textContent = "";
    document.getElementById("wps-password").value = "";

    const user = await fetchUser(userId);
    renderUser(user);
  } catch (error) {
    wpsMessage.textContent = error instanceof Error ? error.message : "Sign-in failed";
    wpsMessage.className = "message error";
  } finally {
    btn.disabled = false;
  }
});

calendarSaveBtn.addEventListener("click", async () => {
  const userId = getUserId();
  if (!userId) return;

  const option = calendarSelect.selectedOptions[0];
  if (!option) return;

  calendarSaveBtn.disabled = true;
  calendarMessage.textContent = "Saving…";
  calendarMessage.className = "message";

  try {
    const res = await fetch(`/api/google/${userId}/calendar`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        calendarId: option.value,
        calendarName: option.dataset.name || option.textContent,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save calendar");

    calendarMessage.textContent = `Using ${data.calendarName}`;
    calendarMessage.className = "message success";

    const user = await fetchUser(userId);
    renderUser(user);
  } catch (error) {
    calendarMessage.textContent =
      error instanceof Error ? error.message : "Failed to save calendar";
    calendarMessage.className = "message error";
  } finally {
    calendarSaveBtn.disabled = false;
  }
});

colorOptions.addEventListener("click", (event) => {
  const button = event.target.closest(".color-option");
  if (!button) return;
  renderColorOptions(button.dataset.colorId);
});

colorSaveBtn.addEventListener("click", async () => {
  const userId = getUserId();
  if (!userId) return;

  colorSaveBtn.disabled = true;
  calendarMessage.textContent = "Saving…";
  calendarMessage.className = "message";

  try {
    const res = await fetch(`/api/google/${userId}/color`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ colorId: selectedColorId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save color");

    calendarMessage.textContent = `Color set to ${data.colorName}`;
    calendarMessage.className = "message success";

    const user = await fetchUser(userId);
    renderUser(user);
  } catch (error) {
    calendarMessage.textContent =
      error instanceof Error ? error.message : "Failed to save color";
    calendarMessage.className = "message error";
  } finally {
    colorSaveBtn.disabled = false;
  }
});

syncBtn.addEventListener("click", async () => {
  const userId = getUserId();
  if (!userId) return;

  syncBtn.disabled = true;
  syncStatus.textContent = "Syncing your schedule…";
  syncStatus.className = "sync-status";

  try {
    const res = await fetch(`/api/sync/${userId}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Sync failed");

    const user = await fetchUser(userId);
    const calendarName = user.google.calendarName || "your calendar";
    syncStatus.textContent = `Synced to ${calendarName}. ${formatSyncSummary(data.result)}`;
    syncStatus.className = "sync-status success";
    renderUser(user);
  } catch (error) {
    syncStatus.textContent = error instanceof Error ? error.message : "Sync failed";
    syncStatus.className = "sync-status error";
  } finally {
    syncBtn.disabled = !wpsStatus.classList.contains("connected");
  }
});

logoutBtn.addEventListener("click", async () => {
  const userId = getUserId();
  if (!userId) {
    showSetup();
    return;
  }

  logoutBtn.disabled = true;

  try {
    await fetch(`/api/users/${userId}/logout`, { method: "POST" });
  } catch {
    // Still sign out locally if the request fails.
  }

  clearUserId();
  showSetup("You have been signed out.");
  logoutBtn.disabled = false;
});

init();
