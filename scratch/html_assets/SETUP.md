# Swift Ride LLP — Real Payments & Tracking Setup

## What was built

- **Real Stripe payments** via Supabase Edge Function (secret key never in browser)
- **Real order tracking** — polling Supabase every 10s for live status
- **Auto-advance** — status moves confirmed → in_progress (30s) → completed (2 min) automatically
- **Admin override** — admin can click "Start Ride" / "Complete Ride" / "Cancel" on any booking
- **Driver assignment** — admin can assign any driver to a booking from the modal

---

## Step 1 — Stripe keys

1. Go to https://dashboard.stripe.com/test/apikeys
2. Copy your **Publishable key** (`pk_test_...`)
3. Open `book.html` and replace line:
   ```javascript
   const STRIPE_PK = 'pk_test_REPLACE_WITH_YOUR_STRIPE_PUBLISHABLE_KEY';
   ```
4. Keep your **Secret key** (`sk_test_...`) for Step 3

---

## Step 2 — Supabase SQL (run in SQL Editor)

Go to https://supabase.com/dashboard → your project → SQL Editor, then run:

```sql
-- Allow bookings to store driver info and payment ID
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS driver_name TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS driver_vehicle TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_intent_id TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Allow payments to store Stripe payment intent ID
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_intent_id TEXT;

-- Make sure RLS policies allow anonymous reads/writes (for demo)
-- Run for each table: bookings, payments, coupons, settings, drivers, cars
CREATE POLICY IF NOT EXISTS "allow_all_bookings" ON bookings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "allow_all_payments" ON payments FOR ALL USING (true) WITH CHECK (true);
```

---

## Step 3 — Deploy Supabase Edge Function

Install Supabase CLI if needed:
```bash
npm install -g supabase
```

In a terminal, from the `html_assets` folder:
```bash
# Link your project (find project-ref in Supabase dashboard URL)
supabase link --project-ref wbqbfepextyyqtvgiarc

# Deploy the edge function
supabase functions deploy create-payment-intent

# Set your Stripe secret key as an environment variable
supabase secrets set STRIPE_SECRET_KEY=sk_test_YOUR_SECRET_KEY_HERE
```

---

## Step 4 — Test the full flow

1. Open `book.html` in browser
2. Fill in journey details + passenger info
3. On the payment step, use Stripe test card:
   - **Card number**: `4242 4242 4242 4242`
   - **Expiry**: any future date (e.g. `12/28`)
   - **CVC**: any 3 digits (e.g. `123`)
4. Click "Pay & Confirm"
5. You should reach Step 4 with a booking code like `SR-XXXXXXXX`
6. In admin.html → Bookings tab: booking appears immediately
7. In admin.html → Financials tab: payment appears with Stripe PaymentIntent ID
8. Go to Track tab in book.html → enter your booking code → see real status
9. After 30 seconds, status auto-advances to "En Route"
10. After 2 minutes, status auto-advances to "Completed"

---

## Step 5 — Admin controls

In `admin.html` → any booking row → click to open modal:
- **Start Ride** → changes status to `in_progress` (track page updates within 10s)
- **Complete Ride** → changes status to `completed`
- **Cancel** → marks booking cancelled
- **Assign Driver** → pick from dropdown, saves driver name/vehicle to booking

---

## Test cards for different scenarios

| Card | Result |
|------|--------|
| 4242 4242 4242 4242 | Success |
| 4000 0000 0000 0002 | Declined |
| 4000 0025 0000 3155 | 3D Secure required |
| 4000 0000 0000 9995 | Insufficient funds |
