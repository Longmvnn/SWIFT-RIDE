import {
  createSupabaseClient,
  escapeHtml,
  formatCurrency,
  formatTimestamp,
  getSupabaseConfig,
  hasRequiredEmailSuffix,
  normalizeEmail,
  setStatus,
} from "./driver-management-shared.js"

const ADMIN_EMAIL_SUFFIX = "@swiftride"
const DRIVER_EMAIL_SUFFIX = "@swiftrider"
const SETTINGS_ROW_ID = 1

const client = createSupabaseClient({
  storageKey: "swiftride-admin-session",
})
const config = getSupabaseConfig()

const loginView = document.querySelector("#admin-login-view")
const appView = document.querySelector("#admin-app-view")
const configWarning = document.querySelector("#config-warning")
const loginForm = document.querySelector("#admin-login-form")
const loginStatus = document.querySelector("#admin-login-status")
const logoutButton = document.querySelector("#logout-button")
const adminIdentity = document.querySelector("#admin-identity")
const createForm = document.querySelector("#driver-create-form")
const createStatus = document.querySelector("#driver-create-status")
const credentialsCard = document.querySelector("#generated-credentials")
const driversTableBody = document.querySelector("#drivers-table-body")
const driverCount = document.querySelector("#driver-count")
const activeCount = document.querySelector("#active-count")
const onlineCount = document.querySelector("#online-count")
const settingsForm = document.querySelector("#settings-form")
const settingsStatus = document.querySelector("#settings-status")
const serviceStatusBanner = document.querySelector("#service-status-banner")
const dispatchModeBadge = document.querySelector("#dispatch-mode-badge")

let realtimeChannel = null

if (!config.isConfigured) {
  configWarning.classList.remove("hidden")
}

if (!client) {
  loginForm?.querySelector("button")?.setAttribute("disabled", "disabled")
  createForm?.querySelector("button")?.setAttribute("disabled", "disabled")
  settingsForm?.querySelector("button")?.setAttribute("disabled", "disabled")
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault()
  if (!client) return

  const formData = new FormData(loginForm)
  const email = normalizeEmail(formData.get("email"))
  const password = String(formData.get("password") ?? "")

  if (!hasRequiredEmailSuffix(email, ADMIN_EMAIL_SUFFIX) || hasRequiredEmailSuffix(email, DRIVER_EMAIL_SUFFIX)) {
    await client.auth.signOut()
    setStatus(loginStatus, "Admin access requires an email ending in @swiftride.", "error")
    return
  }

  setStatus(loginStatus, "Signing in...", "slate")

  const { error } = await client.auth.signInWithPassword({ email, password })

  if (error) {
    setStatus(loginStatus, error.message, "error")
    return
  }

  setStatus(loginStatus, "Signed in.", "success")
})

logoutButton?.addEventListener("click", async () => {
  if (!client) return
  await client.auth.signOut()
})

createForm?.addEventListener("submit", async (event) => {
  event.preventDefault()
  if (!client) return

  const {
    data: { session },
  } = await client.auth.getSession()

  if (!session) {
    setStatus(createStatus, "Sign in as an admin first.", "error")
    return
  }

  const formData = new FormData(createForm)
  const fullName = String(formData.get("full_name") ?? "").trim()
  const email = normalizeEmail(formData.get("email"))

  if (!hasRequiredEmailSuffix(email, DRIVER_EMAIL_SUFFIX)) {
    setStatus(createStatus, "Driver emails must end in @swiftrider.", "error")
    return
  }

  setStatus(createStatus, "Creating driver account...", "slate")

  const response = await fetch(`${config.functionsBaseUrl}/create-driver`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: config.supabaseAnonKey,
    },
    body: JSON.stringify({ full_name: fullName, email }),
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    setStatus(createStatus, payload.error || "Failed to create driver.", "error")
    return
  }

  credentialsCard.classList.remove("hidden")
  credentialsCard.querySelector("[data-field='email']").textContent = payload.email
  credentialsCard.querySelector("[data-field='password']").textContent = payload.password
  setStatus(createStatus, "Driver account created.", "success")
  createForm.reset()
  await loadDrivers()
})

settingsForm?.addEventListener("submit", async (event) => {
  event.preventDefault()
  if (!client) return

  const formData = new FormData(settingsForm)
  const payload = {
    id: SETTINGS_ROW_ID,
    base_fare: Number(formData.get("base_fare") ?? 0),
    price_per_km: Number(formData.get("price_per_km") ?? 0),
    minimum_fare: Number(formData.get("minimum_fare") ?? 0),
    dispatch_mode: String(formData.get("dispatch_mode") ?? "auto"),
    service_status: formData.get("service_status") === "on",
  }

  setStatus(settingsStatus, "Saving settings...", "slate")

  const { error } = await client.from("settings").upsert(payload, { onConflict: "id" })

  if (error) {
    setStatus(settingsStatus, error.message, "error")
    return
  }

  setStatus(settingsStatus, "Settings saved globally.", "success")
  renderSettingsSummary(payload)
})

driversTableBody?.addEventListener("change", async (event) => {
  if (!client) return

  const target = event.target
  if (!(target instanceof HTMLInputElement) || target.dataset.action !== "toggle-active") {
    return
  }

  const id = target.dataset.id
  const isActive = target.checked
  target.disabled = true

  const updatePayload = isActive
    ? { is_active: true }
    : { is_active: false, is_online: false }

  const { error } = await client.from("drivers").update(updatePayload).eq("id", id)

  if (error) {
    target.checked = !isActive
    window.alert(error.message)
  }

  target.disabled = false
})

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const field = button.getAttribute("data-copy")
    const value = document.querySelector(`[data-field='${field}']`)?.textContent ?? ""
    await navigator.clipboard.writeText(value)
    button.textContent = "Copied"
    window.setTimeout(() => {
      button.textContent = "Copy"
    }, 1200)
  })
})

async function bootstrap() {
  if (!client) return

  client.auth.onAuthStateChange(async (_event, session) => {
    await renderForSession(session)
  })

  const {
    data: { session },
  } = await client.auth.getSession()

  await renderForSession(session)
}

async function renderForSession(session) {
  if (!session) {
    stopRealtime()
    loginView.classList.remove("hidden")
    appView.classList.add("hidden")
    adminIdentity.textContent = "Not signed in"
    return
  }

  const email = normalizeEmail(session.user.email)
  const userRole = session.user.app_metadata?.role
  if (
    userRole !== "admin" ||
    !hasRequiredEmailSuffix(email, ADMIN_EMAIL_SUFFIX) ||
    hasRequiredEmailSuffix(email, DRIVER_EMAIL_SUFFIX)
  ) {
    await client.auth.signOut()
    setStatus(loginStatus, "This page requires an admin account ending in @swiftride.", "error")
    return
  }

  loginView.classList.add("hidden")
  appView.classList.remove("hidden")
  adminIdentity.textContent = session.user.email ?? "Admin"
  await loadSettings()
  await loadDrivers()
  startRealtime()
}

async function loadSettings() {
  if (!client) return

  const { data, error } = await client
    .from("settings")
    .select("id, base_fare, price_per_km, minimum_fare, dispatch_mode, service_status")
    .eq("id", SETTINGS_ROW_ID)
    .maybeSingle()

  if (error) {
    setStatus(settingsStatus, error.message, "error")
    return
  }

  const settings = data ?? {
    id: SETTINGS_ROW_ID,
    base_fare: 12,
    price_per_km: 1.5,
    minimum_fare: 15,
    dispatch_mode: "auto",
    service_status: true,
  }

  const baseFareField = settingsForm?.querySelector("[name='base_fare']")
  if (baseFareField) {
    baseFareField.value = String(settings.base_fare)
  }

  const pricePerKmField = settingsForm?.querySelector("[name='price_per_km']")
  if (pricePerKmField) {
    pricePerKmField.value = String(settings.price_per_km)
  }

  const minimumFareField = settingsForm?.querySelector("[name='minimum_fare']")
  if (minimumFareField) {
    minimumFareField.value = String(settings.minimum_fare)
  }

  const dispatchField = settingsForm?.querySelector("[name='dispatch_mode']")
  if (dispatchField) {
    dispatchField.value = settings.dispatch_mode
  }

  const serviceField = settingsForm?.querySelector("[name='service_status']")
  if (serviceField) {
    serviceField.checked = Boolean(settings.service_status)
  }

  renderSettingsSummary(settings)
}

async function loadDrivers() {
  if (!client) return

  const { data, error } = await client
    .from("drivers")
    .select("id, full_name, email, is_active, is_online, updated_at")
    .order("created_at", { ascending: false })

  if (error) {
    driversTableBody.innerHTML = `<tr><td colspan="5" class="px-6 py-8 text-center text-rose-600">${escapeHtml(error.message)}</td></tr>`
    return
  }

  const drivers = data ?? []
  driverCount.textContent = String(drivers.length)
  activeCount.textContent = String(drivers.filter((driver) => driver.is_active).length)
  onlineCount.textContent = String(drivers.filter((driver) => driver.is_online).length)

  if (!drivers.length) {
    driversTableBody.innerHTML = `<tr><td colspan="5" class="px-6 py-8 text-center text-slate-500">No drivers created yet.</td></tr>`
    return
  }

  driversTableBody.innerHTML = drivers
    .map(
      (driver) => `
        <tr class="border-t border-slate-100">
          <td class="px-6 py-4">
            <div class="font-semibold text-slate-900">${escapeHtml(driver.full_name)}</div>
            <div class="text-xs text-slate-500">${escapeHtml(driver.email)}</div>
          </td>
          <td class="px-6 py-4">
            <span class="inline-flex rounded-full px-3 py-1 text-xs font-bold ${driver.is_online ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}">
              ${driver.is_online ? "Online" : "Offline"}
            </span>
          </td>
          <td class="px-6 py-4">
            <label class="inline-flex items-center gap-3 text-sm font-medium text-slate-700">
              <span class="relative inline-flex h-7 w-12 items-center">
                <input class="peer sr-only" data-action="toggle-active" data-id="${driver.id}" type="checkbox" ${driver.is_active ? "checked" : ""}/>
                <span class="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-blue-600"></span>
                <span class="absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition peer-checked:translate-x-5"></span>
              </span>
              ${driver.is_active ? "Enabled" : "Disabled"}
            </label>
          </td>
          <td class="px-6 py-4 text-sm text-slate-600">${driver.is_active ? "Driver can go online" : "Forced offline by admin"}</td>
          <td class="px-6 py-4 text-sm text-slate-500">${escapeHtml(formatTimestamp(driver.updated_at))}</td>
        </tr>
      `,
    )
    .join("")
}

function startRealtime() {
  if (!client || realtimeChannel) return

  realtimeChannel = client
    .channel("admin-dashboard-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "drivers" },
      async () => {
        await loadDrivers()
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "settings" },
      async () => {
        await loadSettings()
      },
    )
    .subscribe()
}

function stopRealtime() {
  if (!client || !realtimeChannel) return
  client.removeChannel(realtimeChannel)
  realtimeChannel = null
}

function renderSettingsSummary(settings) {
  if (serviceStatusBanner) {
    serviceStatusBanner.textContent = settings.service_status ? "Service is live" : "Service is paused"
    serviceStatusBanner.className = settings.service_status
      ? "rounded-full bg-emerald-100 px-4 py-2 text-sm font-semibold text-emerald-700"
      : "rounded-full bg-rose-100 px-4 py-2 text-sm font-semibold text-rose-700"
  }

  if (dispatchModeBadge) {
    dispatchModeBadge.textContent =
      settings.dispatch_mode === "manual" ? "Manual dispatch" : "Auto dispatch"
  }

  const helper = document.querySelector("#fare-summary")
  if (helper) {
    helper.textContent = `Base ${formatCurrency(settings.base_fare)} • ${formatCurrency(settings.price_per_km)}/km • Minimum ${formatCurrency(settings.minimum_fare)}`
  }
}

bootstrap()
