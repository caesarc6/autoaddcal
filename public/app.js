const FETCH_OPTS = { credentials: "include" };

const setup = document.getElementById("setup");
const dashboard = document.getElementById("dashboard");
const setupMessage = document.getElementById("setup-message");
const wpsForm = document.getElementById("wps-form");
const wpsBlock = document.getElementById("wps-block");
const wpsStatus = document.getElementById("wps-status");
const calendarBlock = document.getElementById("calendar-block");
const calendarSelect = document.getElementById("calendar-select");
const colorOptions = document.getElementById("color-options");
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
const profileSettings = document.getElementById("profile-settings");
const profileSaveEmployeeId = document.getElementById("profile-save-employee-id");
const profileSavePassword = document.getElementById("profile-save-password");
const profilePasswordWrap = document.getElementById("profile-password-wrap");
const profilePassword = document.getElementById("profile-password");
const profileSaveBtn = document.getElementById("profile-save-btn");
const profileMessage = document.getElementById("profile-message");
const saveEmployeeIdLogin = document.getElementById("save-employee-id");
const savePasswordLogin = document.getElementById("save-password");
const employeeNumberInput = document.getElementById("employee-number");

let eventColors = [];
let selectedColorId = "8";
let calendarSaving = false;
let colorSaving = false;
let profileHasSavedPassword = false;

function cleanAuthParamsFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("user");
  url.searchParams.delete("google");
  url.searchParams.delete("message");
  window.history.replaceState({}, "", url);
}

function showSetup(message = "", isError = false) {
  setup.classList.remove("hidden");
  dashboard.classList.add("hidden");
  navbar.classList.add("hidden");
  setupMessage.textContent = message;
  setupMessage.className = isError ? "message error" : "message";
}

async function fetchUser() {
  const res = await fetch("/api/users/me", FETCH_OPTS);
  if (!res.ok) throw new Error("Not authenticated");
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

  window.mountAutoSyncToggle(root, {
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

  if (data.profile?.saveEmployeeId) {
    lines.push("Employee ID saved to your profile");
  }
  if (data.profile?.savePassword) {
    lines.push("Password saved for automatic sync");
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

function renderProfileSettings(data) {
  const profile = data.profile ?? {};
  profileHasSavedPassword = Boolean(profile.hasSavedPassword);
  profileSaveEmployeeId.checked = Boolean(profile.saveEmployeeId);
  profileSavePassword.checked = Boolean(profile.savePassword);
  profilePassword.value = "";
  profilePasswordWrap.classList.toggle("hidden", !profileSavePassword.checked);
  profileMessage.textContent = "";
  profileSettings.classList.toggle("hidden", !data.google.connected);
}

function renderLoginForm(data) {
  const profile = data.profile ?? {};
  saveEmployeeIdLogin.checked = Boolean(profile.saveEmployeeId);
  savePasswordLogin.checked = Boolean(profile.savePassword);

  const savedId = profile.savedEmployeeNumber || data.wps?.employeeNumber || "";
  if (savedId && !employeeNumberInput.value) {
    employeeNumberInput.value = savedId;
  }
}

function renderUser(data) {
  if (!data.google.connected) {
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
    renderLoginForm(data);
  }

  calendarBlock.classList.remove("hidden");
  renderProfileSettings(data);
  loadCalendarPicker(data.google);

  syncBtn.disabled = !(data.wps.connected && data.google.connected);
  renderOverviewMeta(data);
  void renderAutoSyncToggle(data);
}

async function loadEventColors() {
  if (eventColors.length) return eventColors;
  const res = await fetch("/api/google/event-colors", FETCH_OPTS);
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

async function saveCalendarSelection() {
  if (calendarSaving) return;
  const option = calendarSelect.selectedOptions[0];
  if (!option) return;

  calendarSaving = true;
  calendarMessage.textContent = "Saving calendar…";
  calendarMessage.className = "message";

  try {
    const res = await fetch("/api/google/calendar", {
      method: "PUT",
      credentials: "include",
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

    const user = await fetchUser();
    renderOverviewMeta(user);
  } catch (error) {
    calendarMessage.textContent =
      error instanceof Error ? error.message : "Failed to save calendar";
    calendarMessage.className = "message error";
  } finally {
    calendarSaving = false;
  }
}

async function saveColorSelection(colorId) {
  if (colorSaving) return;

  colorSaving = true;
  calendarMessage.textContent = "Saving color…";
  calendarMessage.className = "message";

  try {
    const res = await fetch("/api/google/color", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ colorId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save color");

    calendarMessage.textContent = `Color set to ${data.colorName}`;
    calendarMessage.className = "message success";

    const user = await fetchUser();
    renderOverviewMeta(user);
  } catch (error) {
    calendarMessage.textContent =
      error instanceof Error ? error.message : "Failed to save color";
    calendarMessage.className = "message error";
  } finally {
    colorSaving = false;
  }
}

async function loadCalendarPicker(google) {
  calendarMessage.textContent = "Loading calendars…";
  calendarMessage.className = "message";

  try {
    await loadEventColors();
    renderColorOptions(google.eventColorId || "8");

    const res = await fetch("/api/google/calendars", FETCH_OPTS);
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

  cleanAuthParamsFromUrl();

  if (googleError && errorMessage) {
    showSetup(decodeURIComponent(errorMessage), true);
    return;
  }

  try {
    const data = await fetchUser();
    renderUser(data);
  } catch {
    showSetup();
  }
}

wpsForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const employeeNumber = employeeNumberInput.value.trim();
  const password = document.getElementById("wps-password").value;
  const btn = document.getElementById("wps-connect-btn");

  btn.disabled = true;
  wpsMessage.textContent = "Signing in (this may take a minute)…";
  wpsMessage.className = "message";

  try {
    const res = await fetch("/auth/wps/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeNumber,
        password,
        saveEmployeeId: saveEmployeeIdLogin.checked,
        savePassword: savePasswordLogin.checked,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Sign-in failed");

    wpsMessage.textContent = "";
    document.getElementById("wps-password").value = "";

    const user = await fetchUser();
    renderUser(user);
  } catch (error) {
    wpsMessage.textContent = error instanceof Error ? error.message : "Sign-in failed";
    wpsMessage.className = "message error";
  } finally {
    btn.disabled = false;
  }
});

calendarSelect.addEventListener("change", () => {
  void saveCalendarSelection();
});

colorOptions.addEventListener("click", (event) => {
  const button = event.target.closest(".color-option");
  if (!button) return;
  const colorId = button.dataset.colorId;
  renderColorOptions(colorId);
  void saveColorSelection(colorId);
});

profileSavePassword.addEventListener("change", () => {
  profilePasswordWrap.classList.toggle("hidden", !profileSavePassword.checked);
});

profileSaveBtn.addEventListener("click", async () => {
  if (profileSavePassword.checked && !profilePassword.value && !profileHasSavedPassword) {
    profileMessage.textContent = "Enter your work password to enable automatic sync.";
    profileMessage.className = "message error";
    return;
  }

  profileSaveBtn.disabled = true;
  profileMessage.textContent = "Saving…";
  profileMessage.className = "message";

  try {
    const body = {
      saveEmployeeId: profileSaveEmployeeId.checked,
      savePassword: profileSavePassword.checked,
    };

    if (profileSavePassword.checked && profilePassword.value) {
      body.password = profilePassword.value;
    }

    const res = await fetch("/api/users/me/profile", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save profile settings");

    profilePassword.value = "";
    profileMessage.textContent = "Profile settings saved.";
    profileMessage.className = "message success";

    const user = await fetchUser();
    renderProfileSettings(user);
    renderOverviewMeta(user);
  } catch (error) {
    profileMessage.textContent =
      error instanceof Error ? error.message : "Failed to save profile settings";
    profileMessage.className = "message error";
  } finally {
    profileSaveBtn.disabled = false;
  }
});

syncBtn.addEventListener("click", async () => {
  syncBtn.disabled = true;
  syncStatus.textContent = "Syncing your schedule…";
  syncStatus.className = "sync-status";

  try {
    const res = await fetch("/api/sync", { method: "POST", credentials: "include" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Sync failed");

    const user = await fetchUser();
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
  logoutBtn.disabled = true;

  try {
    await fetch("/api/users/logout", { method: "POST", credentials: "include" });
  } catch {
    // Still sign out locally if the request fails.
  }

  showSetup("You have been signed out.");
  logoutBtn.disabled = false;
});

init();
