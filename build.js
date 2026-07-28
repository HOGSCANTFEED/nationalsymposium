#!/usr/bin/env node
// Rebuilds index.html from index.template.html + the latest data submitted
// via the Google Form (published as CSV). See README.md for the whole flow.
//
// Field semantics are "patch, not snapshot": colleagues only fill in what
// changed and leave the rest blank, so each field's live value is "the most
// recent non-blank submission for that column" across ALL rows, not simply
// the last row. Two checkboxes (for the warning banner and the upcoming
// dates list) are the explicit way to clear a field back to empty, since
// blank everywhere else means "no change."
//
// Refuses to write index.html if the feed can't be fetched/parsed or a
// required field is missing after merging — a red run in Actions means
// "look at this," never "the site went blank."

const fs = require('fs');
const path = require('path');

const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ24vECEjFyUMcwZTBqApgZWYsz3driXPiGuE-zO9RAnPEI5Ls3w-Ei7OK6pS4wkJbDezBPXiJI1DXr/pub?output=csv';

const TEMPLATE_PATH = path.join(__dirname, 'index.template.html');
const OUTPUT_PATH = path.join(__dirname, 'index.html');

// The "posters" page — a print-ready A4 poster built from the same merged data
// (speakers, date/time, registration link). Same template/output relationship
// as index: edit poster.template.html, never poster.html.
const POSTER_TEMPLATE_PATH = path.join(__dirname, 'poster.template.html');
const POSTER_OUTPUT_PATH = path.join(__dirname, 'poster.html');

const DEFAULT_TIME_LINE = '12:00 – 1:30 pm AEST';

// Used for every "get in touch" link on the page whenever the form's
// "Contact us form link" question is left blank (which it is by default).
const DEFAULT_CONTACT_LINK = 'https://forms.cloud.microsoft/r/xGB3y3PwXP';

// Each column is identified by the first line of its (possibly multi-line)
// header, matched case-insensitively as a prefix — tolerant of the "eg: ..."
// help text Google Forms appends after a line break, and of minor future
// edits to that help text.
const COLUMN_PREFIXES = {
  regLink: 'registration link',
  regStatus: 'registration status',
  date: 'date of the next symposium',
  time: 'time of the next symposium',
  talk1Name: 'talk one: speaker name',
  talk1Title: 'talk one: talk title or topic description',
  talk1Disc: 'talk one: speaker discipline',
  talk1Loc: 'talk one: speaker location',
  talk2Name: 'talk two: speaker name',
  talk2Title: 'talk two: talk title or topic description',
  talk2Disc: 'talk two: speaker discipline',
  talk2Loc: 'talk two: speaker location',
  talk3Name: 'talk three: speaker name',
  talk3Title: 'talk three: talk title or topic description',
  talk3Disc: 'talk three: speaker discipline',
  talk3Loc: 'talk three: speaker location',
  upcomingText: 'dates of all the upcoming symposiums',
  upcomingClear: 'tick to clear a dates',
  contactLink: 'contact us form link',
  warningText: 'urgent note text',
  warningClear: 'tick to clear all urgent note text',
};

const REQUIRED_FIELDS = ['REG_LINK', 'DATE_LINE', 'BADGE_TEXT', 'TALK_1_NAME', 'TALK_1_TITLE'];

function firstLine(s) {
  return (s || '').split('\n')[0].trim();
}

function nonBlank(v) {
  return v != null && v.trim() !== '';
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Small RFC4180-style parser: handles quoted fields containing commas,
// newlines and doubled ("") quotes, which the real form headers use.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // ignore; \n (handled below) ends the row
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function fillBlock(html, name, keep, replacements) {
  const re = new RegExp(`<!--BLOCK:${name}-->([\\s\\S]*?)<!--\\/BLOCK:${name}-->`);
  return html.replace(re, (_match, inner) => {
    if (!keep) return '';
    let filled = inner;
    for (const [key, value] of Object.entries(replacements)) {
      filled = filled.split(`{{${key}}}`).join(value);
    }
    return filled;
  });
}

async function fetchRows() {
  const res = await fetch(CSV_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch the form's published CSV: ${res.status} ${res.statusText}`);
  }
  const table = parseCSV(await res.text());
  if (table.length < 2) {
    throw new Error("The form's sheet has no submissions yet (header row only) — nothing to build.");
  }
  const [headerRow, ...dataRows] = table;

  const colIndex = {};
  for (const [key, prefix] of Object.entries(COLUMN_PREFIXES)) {
    const i = headerRow.findIndex((h) => firstLine(h).toLowerCase().startsWith(prefix));
    if (i === -1) {
      throw new Error(
        `Could not find a form column starting with "${prefix}" — has that question been renamed or deleted?`
      );
    }
    colIndex[key] = i;
  }

  const cell = (row, key) => (row[colIndex[key]] || '').trim();
  return { dataRows, cell };
}

// "Most recent non-blank wins" across every submitted row.
function mergeSimple(dataRows, cell, key) {
  let value = '';
  for (const row of dataRows) {
    const v = cell(row, key);
    if (nonBlank(v)) value = v;
  }
  return value;
}

// Same, but a ticked clear-checkbox explicitly blanks the field even if
// later rows leave both the checkbox and the text blank.
function mergeWithClear(dataRows, cell, textKey, clearKey) {
  let value = '';
  for (const row of dataRows) {
    if (nonBlank(cell(row, clearKey))) {
      value = '';
    } else if (nonBlank(cell(row, textKey))) {
      value = cell(row, textKey);
    }
  }
  return value;
}

async function main() {
  const { dataRows, cell } = await fetchRows();
  const simple = (key) => mergeSimple(dataRows, cell, key);

  const data = {
    REG_LINK: simple('regLink'),
    CONTACT_LINK: simple('contactLink') || DEFAULT_CONTACT_LINK,
    DATE_LINE: simple('date'),
    TIME_LINE: simple('time') || DEFAULT_TIME_LINE,
    BADGE_TEXT: simple('regStatus'),
    TALK_1_NAME: simple('talk1Name'),
    TALK_1_TITLE: simple('talk1Title'),
    TALK_1_DISC: simple('talk1Disc'),
    TALK_1_LOCATION: simple('talk1Loc'),
    TALK_2_NAME: simple('talk2Name'),
    TALK_2_TITLE: simple('talk2Title'),
    TALK_2_DISC: simple('talk2Disc'),
    TALK_2_LOCATION: simple('talk2Loc'),
    TALK_3_NAME: simple('talk3Name'),
    TALK_3_TITLE: simple('talk3Title'),
    TALK_3_DISC: simple('talk3Disc'),
    TALK_3_LOCATION: simple('talk3Loc'),
  };

  const warningText = mergeWithClear(dataRows, cell, 'warningText', 'warningClear');
  const upcomingText = mergeWithClear(dataRows, cell, 'upcomingText', 'upcomingClear');

  const missing = REQUIRED_FIELDS.filter((k) => !nonBlank(data[k]));
  if (missing.length > 0) {
    throw new Error(
      `Refusing to rebuild the site — required field(s) missing after merging all form submissions: ${missing.join(', ')}`
    );
  }

  let html = fs.readFileSync(TEMPLATE_PATH, 'utf8');

  html = fillBlock(html, 'WARNING', nonBlank(warningText), {
    WARNING_TEXT: escapeHtml(warningText),
  });

  const upcomingItems = upcomingText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  html = fillBlock(html, 'UPCOMING', upcomingItems.length > 0, {
    UPCOMING_LIST: upcomingItems.map((d) => `<li>${escapeHtml(d)}</li>`).join(''),
  });

  for (const [key, value] of Object.entries(data)) {
    html = html.split(`{{${key}}}`).join(escapeHtml(value));
  }

  fs.writeFileSync(OUTPUT_PATH, html);
  console.log('index.html rebuilt from form data.');

  // ---- Poster page ----
  // Same data, a different template. The poster only surfaces the speakers,
  // date/time and registration link, so a plain token swap over `data` is all
  // it needs — no BLOCK sections. Values are escaped exactly as for index.html.
  let poster = fs.readFileSync(POSTER_TEMPLATE_PATH, 'utf8');
  for (const [key, value] of Object.entries(data)) {
    poster = poster.split(`{{${key}}}`).join(escapeHtml(value));
  }
  fs.writeFileSync(POSTER_OUTPUT_PATH, poster);
  console.log('poster.html rebuilt from form data.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
