# NK Surgical

Schedule + invoicing app for Niaz Khan. Static frontend (no build step) hosted
on GitHub Pages, backend on Supabase (Postgres + Auth). Works on mobile and
desktop.

- **Calendar** (landing page) — assign hospitals/surgeons per day, with
  Month / Week / Year / Custom-range views. A day can hold multiple entries.
- **Invoicing** — a full rebuild of the original Khanz Healthcare invoicing
  app (see `legacy/khanz-invoice-standalone.html`) as a native tab, sharing
  the same login and storing records in Supabase instead of
  localStorage + Google Sheets.

## One-time setup

### 1. Supabase

1. Create a Supabase project (or use the one you're setting up separately for
   this app).
2. Apply the schema in `supabase/migrations/` — either:
   - `supabase link --project-ref <your-ref>` then `supabase db push`, or
   - paste the contents of the migration file into the Supabase dashboard's
     SQL Editor and run it.
3. Create your login: **Authentication → Users → Add user** with your email
   and a password. There is no public sign-up screen — this is a single-user
   app gated by Supabase Auth + Row Level Security.
4. Copy **Project Settings → API → Project URL** and **anon public key** into
   [`js/config.js`](js/config.js).

### 2. GitHub Pages

1. Push this repo to your GitHub remote.
2. In the repo: **Settings → Pages → Build and deployment → Deploy from a
   branch**, branch `main`, folder `/ (root)`.
3. The site will be live at `https://<you>.github.io/<repo>/`.

## Project structure

```
index.html            App shell: login gate, header/tabs, calendar + invoicing pages, modals
css/styles.css         Shared design system (colours, header, buttons, modal, toast)
css/calendar.css       Month/Week/Year/Custom views
css/invoicing.css      Invoice form, records list, printable invoice document
js/config.js           Supabase URL + anon key (fill in — see setup above)
js/supabaseClient.js   Supabase client instance
js/auth.js             Login/logout, session state, gating the app shell
js/calendar.js         Calendar views + CRUD against the `assignments` table
js/invoicing.js        Invoice form/records/settings against `invoices` + `app_settings`
js/util.js             Date formatting, colour hashing, toast helper
js/app.js              Boot sequence + tab switching
supabase/migrations/   Schema: assignments, invoices, app_settings (all RLS-scoped to auth.uid())
assets/                Logo, favicon
legacy/                Original standalone invoicing app + a photo of the paper calendar it replaces, kept as reference
```

## Data model notes

- `assignments`: one row per calendar entry — `surgeon` and/or `hospital`
  (free text), optional `note`, `status` (`confirmed`/`cancelled`), and
  `is_day_off` for days off. Colour is auto-derived from the surgeon+hospital
  combination (consistent every time the same pair appears) but can be
  overridden per entry.
- `invoices`: ported 1:1 from the original app's record shape (`shifts` is a
  JSON array of `{date, rate}`).
- `app_settings`: one JSON row per user holding the invoice letterhead/bank
  details shown on generated invoice documents (editable from the Invoicing →
  Settings tab).
