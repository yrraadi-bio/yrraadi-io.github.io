/* Where an access request is written down.

   Paste this into a Google Apps Script project bound to a spreadsheet, deploy it
   as a web app, and put the /exec URL into ENDPOINT in access.js. Every request
   from the site's form and from the workspace's gate appends one row.

   The site posts as text/plain on purpose. Any other content type makes the
   browser send a CORS preflight, and Apps Script does not answer OPTIONS, so a
   JSON content type fails before the request is ever made.

   Deploying: Extensions > Apps Script from the sheet, paste this over Code.gs,
   then Deploy > New deployment > Web app, with "Execute as" set to yourself and
   "Who has access" set to Anyone. Take the /exec URL from the dialog. Any later
   edit needs Deploy > Manage deployments > Edit > New version, or the old code
   keeps serving. */

const SHEET = 'Requests';

const COLUMNS = ['submitted_at', 'firstName', 'lastName', 'email', 'company', 'subject', 'page'];

/* Nothing here is trusted. The endpoint sits in a public JavaScript file, so
   anyone can find it and post to it, and the only real defence is to keep what
   lands small, shaped, and obviously junk-free. */
const LIMIT = 200;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function doPost(request) {

  const row = JSON.parse(request.postData.contents);

  if (!EMAIL_SHAPE.test(String(row.email || ''))) return reply({ ok: false, error: 'bad email' });

  const sheet = requests();
  sheet.appendRow(COLUMNS.map(function (name) { return clip(row[name]); }));

  return reply({ ok: true });
}

/* A GET is what a browser does if someone opens the URL out of curiosity, and it
   should say nothing about the sheet behind it */
function doGet() {
  return reply({ ok: true });
}

function requests() {

  const book = SpreadsheetApp.getActiveSpreadsheet();
  const found = book.getSheetByName(SHEET);
  if (found) return found;

  const sheet = book.insertSheet(SHEET);
  sheet.appendRow(COLUMNS);
  sheet.setFrozenRows(1);

  return sheet;
}

/* Long strings are the cheapest way to make a mess of a spreadsheet, and a leading
   =, + or @ makes a cell a formula rather than a name */
function clip(value) {

  const text = String(value == null ? '' : value).slice(0, LIMIT);

  return /^[=+@-]/.test(text) ? "'" + text : text;
}

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
