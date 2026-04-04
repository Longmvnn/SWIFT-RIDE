const PLACEHOLDER_PREFIX = "YOUR_"

export function getSupabaseConfig() {
  const config = window.VELOCITY_CONFIG ?? {}
  const supabaseUrl = config.supabaseUrl ?? ""
  const supabaseAnonKey = config.supabaseAnonKey ?? ""
  const functionsBaseUrl =
    config.functionsBaseUrl || (supabaseUrl ? `${supabaseUrl}/functions/v1` : "")

  const isConfigured =
    supabaseUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes(PLACEHOLDER_PREFIX) &&
    !supabaseAnonKey.includes(PLACEHOLDER_PREFIX)

  return {
    supabaseUrl,
    supabaseAnonKey,
    functionsBaseUrl,
    isConfigured,
  }
}

export function createSupabaseClient(options = {}) {
  const { supabaseUrl, supabaseAnonKey, isConfigured } = getSupabaseConfig()
  const {
    storageKey = "swiftride-session",
    detectSessionInUrl = true,
  } = options

  if (!isConfigured) {
    return null
  }

  return window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl,
      storageKey,
    },
  })
}

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase()
}

export function hasRequiredEmailSuffix(email, suffix) {
  return normalizeEmail(email).endsWith(suffix)
}

export function formatCurrency(value) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(Number(value ?? 0) || 0)
}

export function setStatus(element, message, tone = "slate") {
  if (!element) return

  const toneClasses = {
    slate: "text-slate-500",
    success: "text-emerald-600",
    error: "text-rose-600",
    warning: "text-amber-600",
  }

  element.className = `text-sm font-medium ${toneClasses[tone] || toneClasses.slate}`
  element.textContent = message
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function formatTimestamp(value) {
  if (!value) return "Just now"

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Just now"

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}
