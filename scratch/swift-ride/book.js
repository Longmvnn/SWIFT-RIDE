import {
  createSupabaseClient,
  formatCurrency,
  getSupabaseConfig,
  setStatus,
} from "./driver-management-shared.js"

const SETTINGS_ROW_ID = 1
const DEFAULT_DISTANCE_KM = 20
const DEFAULT_SETTINGS = {
  base_fare: 12,
  price_per_km: 1.5,
  minimum_fare: 15,
  dispatch_mode: "auto",
  service_status: true,
}

const client = createSupabaseClient({
  storageKey: "swiftride-customer-session",
  detectSessionInUrl: false,
})
const config = getSupabaseConfig()

const configWarning = document.querySelector("#config-warning")
const bookingStatus = document.querySelector("#booking-status")
const serviceStatusBanner = document.querySelector("#service-status-banner")
const dispatchModeText = document.querySelector("#dispatch-mode-text")
const baseFareValue = document.querySelector("#base-fare-value")
const distanceFareValue = document.querySelector("#distance-fare-value")
const serviceFeeValue = document.querySelector("#service-fee-value")
const subtotalValue = document.querySelector("#subtotal-value")
const discountRow = document.querySelector("#discount-row")
const discountValue = document.querySelector("#discount-value")
const totalValue = document.querySelector("#total-value")
const rideButtons = Array.from(document.querySelectorAll("[data-ride-option]"))
const couponForm = document.querySelector("#coupon-form")
const couponInput = document.querySelector("#coupon-code")
const couponStatus = document.querySelector("#coupon-status")

let settings = { ...DEFAULT_SETTINGS }
let selectedRide = "standard"
let appliedCoupon = null

const rideCatalog = {
  standard: { label: "Standard", multiplier: 1 },
  premium: { label: "Premium", multiplier: 1.65 },
  xl: { label: "XL / Van", multiplier: 1.45 },
  medical: { label: "Medical", multiplier: 1.2 },
}

if (!config.isConfigured) {
  configWarning?.classList.remove("hidden")
}

rideButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedRide = button.dataset.rideOption || "standard"
    appliedCoupon = null
    if (couponInput) {
      couponInput.value = ""
    }
    setStatus(couponStatus, "", "slate")
    renderRideSelection()
    renderFareSummary()
  })
})

couponForm?.addEventListener("submit", async (event) => {
  event.preventDefault()
  if (!client) return

  const code = String(couponInput?.value ?? "").trim().toUpperCase()
  if (!code) {
    setStatus(couponStatus, "Enter a coupon code first.", "warning")
    return
  }

  setStatus(couponStatus, "Checking coupon...", "slate")

  const { data, error } = await client
    .from("coupons")
    .select("code, discount_type, discount_value, expiry_date, is_active")
    .eq("code", code)
    .maybeSingle()

  if (error) {
    setStatus(couponStatus, error.message, "error")
    return
  }

  if (!data || !data.is_active) {
    appliedCoupon = null
    renderFareSummary()
    setStatus(couponStatus, "That coupon is invalid or inactive.", "error")
    return
  }

  if (data.expiry_date && new Date(data.expiry_date).getTime() < Date.now()) {
    appliedCoupon = null
    renderFareSummary()
    setStatus(couponStatus, "That coupon has expired.", "error")
    return
  }

  appliedCoupon = data
  renderFareSummary()
  setStatus(couponStatus, `Coupon ${data.code} applied.`, "success")
})

async function bootstrap() {
  if (!client) {
    setStatus(bookingStatus, "Add your Supabase URL and anon key to enable live fares and coupons.", "warning")
    renderRideSelection()
    renderFareSummary()
    return
  }

  await loadSettings()
  renderRideSelection()
  renderFareSummary()
}

async function loadSettings() {
  const { data, error } = await client
    .from("settings")
    .select("base_fare, price_per_km, minimum_fare, dispatch_mode, service_status")
    .eq("id", SETTINGS_ROW_ID)
    .maybeSingle()

  if (error) {
    setStatus(bookingStatus, error.message, "error")
    return
  }

  settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) }

  if (serviceStatusBanner) {
    serviceStatusBanner.textContent = settings.service_status ? "Bookings open" : "Bookings paused"
    serviceStatusBanner.className = settings.service_status
      ? "inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700"
      : "inline-flex rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-700"
  }

  if (dispatchModeText) {
    dispatchModeText.textContent =
      settings.dispatch_mode === "manual"
        ? "Manual dispatch is enabled. Your ride will be assigned by an operator."
        : "Auto dispatch is enabled. The system will assign the best available driver."
  }

  if (!settings.service_status) {
    setStatus(bookingStatus, "Service is currently turned off. New bookings are temporarily unavailable.", "warning")
  } else {
    setStatus(bookingStatus, "Live fare settings loaded from Supabase.", "success")
  }
}

function renderRideSelection() {
  const pricing = calculateFare()

  rideButtons.forEach((button) => {
    const rideKey = button.dataset.rideOption
    const isSelected = rideKey === selectedRide
    const priceNode = button.querySelector("[data-ride-price]")

    if (priceNode && rideKey) {
      const quote = calculateFare(rideKey)
      priceNode.textContent = formatCurrency(quote.totalBeforeDiscount)
    }

    button.className = isSelected
      ? "relative p-4 rounded-xl border-2 border-primary bg-primary/5 text-left transition-all"
      : "relative p-4 rounded-xl border-2 border-transparent bg-surface-container-low hover:bg-surface-container-high text-left transition-all"
  })

  totalValue.textContent = formatCurrency(pricing.totalAfterDiscount)
}

function renderFareSummary() {
  const pricing = calculateFare()

  if (baseFareValue) {
    baseFareValue.textContent = formatCurrency(pricing.baseFare)
  }
  if (distanceFareValue) {
    distanceFareValue.textContent = formatCurrency(pricing.distanceFare)
  }
  if (serviceFeeValue) {
    serviceFeeValue.textContent = formatCurrency(pricing.serviceFee)
  }
  if (subtotalValue) {
    subtotalValue.textContent = formatCurrency(pricing.totalBeforeDiscount)
  }
  if (discountRow) {
    discountRow.classList.toggle("hidden", pricing.discountAmount <= 0)
  }
  if (discountValue) {
    discountValue.textContent = `- ${formatCurrency(pricing.discountAmount)}`
  }
  if (totalValue) {
    totalValue.textContent = formatCurrency(pricing.totalAfterDiscount)
  }
}

function calculateFare(rideKey = selectedRide) {
  const ride = rideCatalog[rideKey] ?? rideCatalog.standard
  const distanceFare = settings.price_per_km * DEFAULT_DISTANCE_KM * ride.multiplier
  const baseFare = settings.base_fare * ride.multiplier
  const serviceFee = 2
  const rawTotal = baseFare + distanceFare + serviceFee
  const totalBeforeDiscount = Math.max(rawTotal, settings.minimum_fare)
  const discountAmount = calculateDiscount(totalBeforeDiscount)
  const totalAfterDiscount = Math.max(totalBeforeDiscount - discountAmount, 0)

  return {
    baseFare,
    distanceFare,
    serviceFee,
    totalBeforeDiscount,
    discountAmount,
    totalAfterDiscount,
  }
}

function calculateDiscount(total) {
  if (!appliedCoupon) return 0

  if (appliedCoupon.discount_type === "percent") {
    return Math.min(total, total * (Number(appliedCoupon.discount_value ?? 0) / 100))
  }

  return Math.min(total, Number(appliedCoupon.discount_value ?? 0))
}

bootstrap()
