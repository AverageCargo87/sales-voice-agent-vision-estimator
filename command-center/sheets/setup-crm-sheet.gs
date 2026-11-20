/**
 * Acme Steel Homes - CRM command center bootstrap (Google Apps Script).
 *
 * HOW TO RUN
 *   1. Create an empty Google Sheet (or open an existing one).
 *   2. Extensions -> Apps Script.
 *   3. Replace the contents of Code.gs with this file and save.
 *   4. Pick setupCRM in the toolbar -> Run, and grant the permissions it asks for.
 *   5. Back in the sheet: 5 CRM tabs plus a Dashboard, formatted and validated.
 *
 * Idempotent: a re-run rewrites HEADERS, validation and formatting but never touches
 * data rows (the Dashboard tab is rebuilt from scratch: it holds only formulas).
 *
 * Then copy the spreadsheet ID from the URL (between /d/ and /edit) into the
 * Google Sheets nodes of the n8n workflows.
 */

// ──────────────────────────────────────────────────────────────────────────
// Schema: tab -> columns. The source of truth for the n8n column mapping
// (voice-agent/scripts/check-config.ts checks the workflows against it).
// ──────────────────────────────────────────────────────────────────────────
const SHEETS = {
  Leads: [
    "lead_id", "created_at", "updated_at", "full_name", "phone", "email",
    "segment", "language", "location", "budget_eur", "plot_size_sqm",
    "desired_size_sqm", "status", "last_outcome", "last_call_at",
    "callback_at", "next_action", "owner_notes", "consent_given", "source",
  ],
  Calls: [
    "call_id", "started_at", "phone", "full_name", "segment", "language",
    "duration_min", "outcome", "summary", "next_action", "callback_at",
    "recording_url", "transcript_url", "eval_booked", "eval_qualified_segment",
  ],
  Bookings: [
    "booking_id", "created_at", "full_name", "phone", "email",
    "preferred_datetime", "meeting_type", "segment", "project_brief",
    "language", "status", "calendar_event_id",
  ],
  Materials_Sent: [
    "sent_at", "full_name", "phone", "recipient", "channel", "materials", "language",
  ],
  Hot_Alerts: [
    "alert_at", "lead_name", "phone", "segment", "urgency", "summary",
    "callback_phone", "language", "handled", "handled_at",
  ],
};

// Allowed values for the drop-down lists (data validation).
const ENUMS = {
  segment: ["b2c_local", "b2c_expat", "landowner_antiparochi", "developer",
            "investor", "business_horeca", "complex_plot", "unknown"],
  language: ["ru", "en", "el"],
  lead_status: ["new", "contacted", "booked", "materials_sent", "callback",
                "won", "lost", "disqualified"],
  // "requested" = written by the book_consultation workflow, before the architect confirms
  booking_status: ["requested", "scheduled", "done", "no_show", "cancelled"],
  outcome: ["qualified_booked", "qualified_followup", "qualified_materials_sent",
            "disqualified", "callback_needed", "transfer_completed", "spam_or_misdialed"],
  urgency: ["hot", "very_hot", "emergency"],
};

const HEADER_BG = "#1a1a2e";
const HEADER_FG = "#ffffff";

function setupCRM() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(SHEETS).forEach(function (name) {
    const sheet = createOrGetSheet_(ss, name);
    writeHeaders_(sheet, SHEETS[name]);
    sheet.setFrozenRows(1);
  });

  applyValidations_(ss);
  applyConditionalFormatting_(ss);
  buildDashboard_(ss);
  reorderSheets_(ss);

  // Remove the default empty "Sheet1" if it exists.
  ["Sheet1"].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && ss.getSheets().length > 1) {
      try { ss.deleteSheet(s); } catch (e) {}
    }
  });

  SpreadsheetApp.getUi().alert(
    "CRM ready\n\nTabs: " + Object.keys(SHEETS).join(", ") + ", Dashboard.\n\n" +
    "Copy the spreadsheet ID from the URL (between /d/ and /edit) into n8n."
  );
}

function createOrGetSheet_(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function writeHeaders_(sheet, headers) {
  const range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight("bold");
  sheet.setColumnWidths(1, headers.length, 150);
  // Wider columns for free text
  ["summary", "notes", "owner_notes", "project_brief", "next_action"].forEach(function (col) {
    const idx = headers.indexOf(col);
    if (idx >= 0) sheet.setColumnWidth(idx + 1, 320);
  });
}

function colLetter_(sheet, headerName) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = headers.indexOf(headerName);
  if (idx < 0) return null;
  return columnToLetter_(idx + 1);
}

function columnToLetter_(col) {
  let temp, letter = "";
  while (col > 0) {
    temp = (col - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    col = (col - temp - 1) / 26;
  }
  return letter;
}

function applyValidations_(ss) {
  setColumnValidation_(ss.getSheetByName("Leads"), "segment", ENUMS.segment);
  setColumnValidation_(ss.getSheetByName("Leads"), "language", ENUMS.language);
  setColumnValidation_(ss.getSheetByName("Leads"), "status", ENUMS.lead_status);
  setColumnValidation_(ss.getSheetByName("Leads"), "last_outcome", ENUMS.outcome);

  setColumnValidation_(ss.getSheetByName("Calls"), "segment", ENUMS.segment);
  setColumnValidation_(ss.getSheetByName("Calls"), "language", ENUMS.language);
  setColumnValidation_(ss.getSheetByName("Calls"), "outcome", ENUMS.outcome);

  setColumnValidation_(ss.getSheetByName("Bookings"), "segment", ENUMS.segment);
  setColumnValidation_(ss.getSheetByName("Bookings"), "language", ENUMS.language);
  setColumnValidation_(ss.getSheetByName("Bookings"), "status", ENUMS.booking_status);

  setColumnValidation_(ss.getSheetByName("Hot_Alerts"), "segment", ENUMS.segment);
  setColumnValidation_(ss.getSheetByName("Hot_Alerts"), "urgency", ENUMS.urgency);

  // A checkbox for "handled" in Hot_Alerts: one click marks an alert as dealt with
  const hot = ss.getSheetByName("Hot_Alerts");
  if (hot) {
    const headers = hot.getRange(1, 1, 1, hot.getLastColumn()).getValues()[0];
    const idx = headers.indexOf("handled");
    if (idx >= 0) hot.getRange(2, idx + 1, hot.getMaxRows() - 1, 1).insertCheckboxes();
  }
}

function setColumnValidation_(sheet, headerName, values) {
  if (!sheet) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = headers.indexOf(headerName);
  if (idx < 0) return;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(2, idx + 1, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
}

function applyConditionalFormatting_(ss) {
  // Hot_Alerts: unhandled alerts red, handled ones green
  const hot = ss.getSheetByName("Hot_Alerts");
  if (hot) {
    const handledCol = colLetter_(hot, "handled");
    const range = hot.getRange(2, 1, hot.getMaxRows() - 1, hot.getLastColumn());
    const rules = [];
    if (handledCol) {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND($' + handledCol + '2<>TRUE, $A2<>"")')
        .setBackground("#ffd6d6")
        .setRanges([range]).build());
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$' + handledCol + '2=TRUE')
        .setBackground("#d9ead3")
        .setRanges([range]).build());
    }
    hot.setConditionalFormatRules(rules);
  }

  // Leads: row colour by status
  const leads = ss.getSheetByName("Leads");
  if (leads) {
    const statusCol = colLetter_(leads, "status");
    if (statusCol) {
      const range = leads.getRange(2, 1, leads.getMaxRows() - 1, leads.getLastColumn());
      const colorByStatus = [
        ["won", "#b6d7a8"], ["booked", "#a4c2f4"], ["callback", "#ffe599"],
        ["lost", "#efefef"], ["disqualified", "#efefef"], ["new", "#fff2cc"],
      ];
      const rules = colorByStatus.map(function (pair) {
        return SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied('=$' + statusCol + '2="' + pair[0] + '"')
          .setBackground(pair[1])
          .setRanges([range]).build();
      });
      leads.setConditionalFormatRules(rules);
    }
  }
}

function buildDashboard_(ss) {
  let dash = ss.getSheetByName("Dashboard");
  if (dash) ss.deleteSheet(dash);
  dash = ss.insertSheet("Dashboard", 0);

  dash.getRange("A1").setValue("ACME STEEL HOMES - Eric command center")
    .setFontSize(16).setFontWeight("bold");
  dash.getRange("A2").setValue("Live formulas over the CRM tabs");
  dash.getRange("A2").setFontColor("#888888");

  // KPI block
  const kpis = [
    ["KPI", ""],
    ["Leads, total", '=COUNTA(Leads!A2:A)'],
    ["Calls today", '=COUNTIFS(Calls!B2:B,">="&TODAY(),Calls!B2:B,"<"&TODAY()+1)'],
    ["Calls, last 7 days", '=COUNTIFS(Calls!B2:B,">="&TODAY()-7)'],
    ["Consultations booked, total", '=COUNTA(Bookings!A2:A)'],
    ["Meetings today", '=COUNTIFS(Bookings!F2:F,">="&TODAY(),Bookings!F2:F,"<"&TODAY()+1)'],
    ["Call -> booking conversion",
      '=IFERROR(TEXT(COUNTIF(Calls!H2:H,"qualified_booked")/COUNTA(Calls!A2:A),"0.0%"),"-")'],
    ["Hot alerts not handled", '=COUNTIFS(Hot_Alerts!I2:I,FALSE)+COUNTIFS(Hot_Alerts!I2:I,"")'],
    ["Callbacks due today", '=COUNTIFS(Leads!P2:P,">="&TODAY(),Leads!P2:P,"<"&TODAY()+1)'],
  ];
  dash.getRange(4, 1, kpis.length, 2).setValues(kpis);
  dash.getRange(4, 1, 1, 2).setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight("bold");
  dash.getRange(5, 1, kpis.length - 1, 1).setFontWeight("bold");

  // Funnel by lead status
  const funnelStart = 4 + kpis.length + 1;
  dash.getRange(funnelStart, 1).setValue("Funnel (by lead status)")
    .setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight("bold");
  dash.getRange(funnelStart, 2).setBackground(HEADER_BG);
  const funnel = ENUMS.lead_status.map(function (st) {
    return [st, '=COUNTIF(Leads!M2:M,"' + st + '")'];
  });
  dash.getRange(funnelStart + 1, 1, funnel.length, 2).setValues(funnel);

  // Leads by segment
  const segStart = funnelStart + funnel.length + 2;
  dash.getRange(segStart, 1).setValue("Leads by segment")
    .setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight("bold");
  dash.getRange(segStart, 2).setBackground(HEADER_BG);
  const segs = ENUMS.segment.map(function (sg) {
    return [sg, '=COUNTIF(Leads!G2:G,"' + sg + '")'];
  });
  dash.getRange(segStart + 1, 1, segs.length, 2).setValues(segs);

  // Today's meetings (right-hand list)
  dash.getRange("D4").setValue("Meetings today")
    .setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight("bold");
  dash.getRange("D5").setFormula(
    '=IFERROR(FILTER({Bookings!C2:C,Bookings!F2:F,Bookings!G2:G,Bookings!K2:K},' +
    'Bookings!F2:F>=TODAY(),Bookings!F2:F<TODAY()+1),"No meetings today")'
  );
  dash.getRange("D4:G4").merge().setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight("bold");

  // Unhandled hot alerts (right-hand list)
  dash.getRange("D16").setValue("Hot alerts (not handled)")
    .setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight("bold");
  dash.getRange("D16:G16").merge().setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight("bold");
  dash.getRange("D17").setFormula(
    '=IFERROR(FILTER({Hot_Alerts!A2:A,Hot_Alerts!B2:B,Hot_Alerts!E2:E,Hot_Alerts!G2:G},' +
    'OR(Hot_Alerts!I2:I=FALSE,Hot_Alerts!I2:I="")),"Nothing pending")'
  );

  dash.setColumnWidth(1, 240);
  dash.setColumnWidth(2, 100);
  dash.setColumnWidth(3, 30);
  dash.setColumnWidths(4, 4, 180);
  dash.setHiddenGridlines(true);
}

function reorderSheets_(ss) {
  const order = ["Dashboard", "Leads", "Calls", "Bookings", "Materials_Sent", "Hot_Alerts"];
  order.forEach(function (name, i) {
    const s = ss.getSheetByName(name);
    if (s) { ss.setActiveSheet(s); ss.moveActiveSheet(i + 1); }
  });
  const dash = ss.getSheetByName("Dashboard");
  if (dash) ss.setActiveSheet(dash);
}
