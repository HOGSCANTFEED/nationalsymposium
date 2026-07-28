# National Paediatric Feeding Symposium — website

## Updating the site each quarter

Fill out this form: **[PASTE THE GOOGLE FORM LINK HERE]**

That's it — no login, no code. The site checks the form once a day and
republishes itself automatically if anything changed. If you need it live
sooner than that, ask Chris to click **Run workflow** on the
[Actions tab](../../actions/workflows/refresh-site.yml) — that rebuilds and
publishes within a couple of minutes.

A few things about how the form works:

- **Leave a question blank if it hasn't changed.** Only fill in what's
  different this quarter — the site remembers everything you don't touch.
- **The two "tick to clear" checkboxes** are the only way to remove the
  urgent note banner or the upcoming-dates list once they've been set —
  leaving those text fields blank does *not* clear them (it just means "no
  change"), so use the checkbox when you actually want them gone.
- If a submission is missing something the site needs (like the date, or
  talk 1's speaker), the site **won't** go blank or break — it just keeps
  showing the last good version until the next valid submission comes in.
  Check the [Actions tab](../../actions/workflows/refresh-site.yml) for a
  red ✗ if an update doesn't seem to be landing.

## How this works, for whoever maintains it next

- `index.template.html` — the actual page design/structure. Edit this file
  (not `index.html`) if the look or layout ever needs to change.
- `index.html` — generated automatically by `build.js`. Never edit this
  file directly; it gets overwritten on the next run.
- `build.js` — fetches the form's responses (published as CSV), merges
  them into the template, and writes `index.html`.
- `.github/workflows/refresh-site.yml` — runs `build.js` once a day (or on
  demand via **Run workflow**) and commits `index.html` if it changed.
  Uses GitHub's own built-in token, so there's no personal access token to
  expire or rotate.
- Hosting is via Vercel's GitHub integration — every push to `main`
  redeploys automatically.

The form's published CSV URL is a constant near the top of `build.js`. If
the Google Form/Sheet is ever recreated from scratch, update that one URL.

## What deliberately isn't here

The Teams join link, the attendee list, and any clinical content never go
on this site or in this repo — same boundary the pitch pack sets out. This
repo only ever holds the same public, low-sensitivity information the site
itself displays.
