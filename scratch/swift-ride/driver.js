import {
  createSupabaseClient,
  escapeHtml,
  getSupabaseConfig,
  hasRequiredEmailSuffix,
  normalizeEmail,
  setStatus,
} from "./driver-management-shared.js"

const DRIVER_EMAIL_SUFFIX = "@swiftrider"

const client = createSupabaseClient({
  storageKey: "swiftride-driver-session",
})
const config = getSupabaseConfig()

const configWarning = document.querySelector("#config-warning")
const loginView = document.querySelector("#driver-login-view")
const appView = document.querySelector("#driver-app-view")
const loginForm = document.querySelector("#driver-login-form")
const loginStatus = document.querySelector("#driver-login-status")
const logoutButton = document.querySelector("#driver-logout-button")
const driverName = document.querySelector("#driver-name")
const driverEmail = document.querySelector("#driver-email")
const activeBadge = document.querySelector("#driver-active-badge")
const toggle = document.querySelector("#go-online-toggle")
const toggleLabel = document.querySelector("#go-online-label")
const driverStatus = document.querySelector("#driver-status-message")

let realtimeChannel = null

if (!config.isConfigured) {
  configWarning.classList.remove("hidden")
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault()
  if (!client) return

  const formData = new FormData(loginForm)
  const email = normalizeEmail(formData.get("email"))
  const password = String(formData.get("password") ?? "")

  if (!hasRequiredEmailSuffix(email, DRIVER_EMAIL_SUFFIX)) {
    await client.auth.signOut()
    setStatus(loginStatus, "Driver access requires an email ending in @swiftrider.", "error")
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

toggle?.addEventListener("change", async () => {
  if (!client) return

  const shouldGoOnline = toggle.checked
  toggle.disabled = true

  const { data: authData } = await client.auth.getUser()
  const userId = authData.user?.id
  if (!userId) {
    toggle.disabled = false
    return
  }

  const { error } = await client
    .from("drivers")
    .update({ is_online: shouldGoOnline })
    .eq("id", userId)

  if (error) {
    toggle.checked = !shouldGoOnline
    setStatus(driverStatus, error.message, "error")
  }

  toggle.disabled = false
})

async function bootstrap() {
  if (!client) {
    loginForm?.querySelector("button")?.setAttribute("disabled", "disabled")
    return
  }

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
    return
  }

  const email = normalizeEmail(session.user.email)
  if (!hasRequiredEmailSuffix(email, DRIVER_EMAIL_SUFFIX)) {
    await client.auth.signOut()
    setStatus(loginStatus, "Driver access requires an email ending in @swiftrider.", "error")
    return
  }

  loginView.classList.add("hidden")
  appView.classList.remove("hidden")
  await loadDriver()
  startRealtime(session.user.id)
}

async function loadDriver() {
  if (!client) return

  const { data: authData } = await client.auth.getUser()
  const user = authData.user
  if (!user) return

  const { data, error } = await client
    .from("drivers")
    .select("id, full_name, email, is_active, is_online")
    .eq("id", user.id)
    .maybeSingle()

  if (error) {
    setStatus(driverStatus, error.message, "error")
    return
  }

  if (!data) {
    driverName.textContent = "Driver record not found"
    driverEmail.textContent = escapeHtml(user.email ?? "")
    toggle.checked = false
    toggle.disabled = true
    activeBadge.textContent = "Missing profile"
    activeBadge.className = "inline-flex rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-700"
    setStatus(driverStatus, "Ask an admin to create your driver profile first.", "warning")
    return
  }

  driverName.textContent = data.full_name
  driverEmail.textContent = data.email
  toggle.checked = Boolean(data.is_online)
  toggle.disabled = !data.is_active
  toggleLabel.textContent = data.is_online ? "You are online" : "You are offline"

  if (data.is_active) {
    activeBadge.textContent = "Admin enabled"
    activeBadge.className = "inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700"
    setStatus(
      driverStatus,
      data.is_online
        ? "You are visible for dispatch."
        : "You can go online whenever you are ready.",
      data.is_online ? "success" : "slate",
    )
  } else {
    activeBadge.textContent = "Admin disabled"
    activeBadge.className = "inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700"
    setStatus(driverStatus, "The admin has disabled your availability. Go Online is locked.", "warning")
  }
}

function startRealtime(userId) {
  if (!client) return
  stopRealtime()

  realtimeChannel = client
    .channel(`driver-self-${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "drivers",
        filter: `id=eq.${userId}`,
      },
      async () => {
        await loadDriver()
      },
    )
    .subscribe()
}

function stopRealtime() {
  if (!client || !realtimeChannel) return
  client.removeChannel(realtimeChannel)
  realtimeChannel = null
}

bootstrap()
