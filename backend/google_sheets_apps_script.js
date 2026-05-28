/**
 * QA Dashboard - Google Apps Script
 * Dark themed Dashboard tab for PM + TestRail summary.
 */

const APP_CONFIG = {
  PM_SHEET: "PM_Activity",
  TESTRAIL_SHEET: "TestRail_Cases",
  TESTRAIL_EXEC_SHEET: "TestRail_Execution",
  DASHBOARD_SHEET: "Dashboard",
  MODULE_COVERAGE_SHEET: "Module_Coverage",
  COLORS: {
    BG: "#111827",
    CARD: "#1f2937",
    BORDER: "#374151",
    TEXT: "#f9fafb",
    MUTED: "#9ca3af",
    CYAN: "#06b6d4",
    GREEN: "#22c55e",
    ORANGE: "#f59e0b",
    PINK: "#ec4899",
    BLUE: "#3b82f6",
    VIOLET: "#8b5cf6",
  }
};

const QC_START_STATUSES = new Set([
  "QC Testing",
  "QC Testing in Progress",
  "QC Testing On-hold",
  "QC Testing Hold",
  "Tested - Awaiting Fixes",
  "QC Review Fail"
]);

const QC_END_STATUSES = new Set([
  "BIS Testing",
  "Closed",
  "Approved for Live",
  "Moved to Live"
]);

// ===== MENU =====
function onOpen() {
  SpreadsheetApp.getUi().createMenu("QA Dashboard")
    .addItem("Setup Dashboard", "setupDashboard")
    .addItem("Refresh Dashboard", "refreshDashboard")
    .addSeparator()
    .addItem("Refresh Module Coverage", "refreshModuleCoverageSheet")
    .addSeparator()
    .addItem("QC Pipeline: Clear filter", "qcPipelineClearFilter")
    .addToUi();
}

function setupDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(APP_CONFIG.DASHBOARD_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(APP_CONFIG.DASHBOARD_SHEET);
  }
  buildDashboardShell(sheet);
  refreshDashboard();
}

function refreshDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(APP_CONFIG.DASHBOARD_SHEET);
  if (!sheet) {
    setupDashboard();
    return;
  }

  // Get selected periods BEFORE clearing sheet
  const selectedPeriod = getSelectedPeriod(sheet);
  const selectedAutomationPeriod = getSelectedAutomationPeriod(sheet);
  const selectedUtilizationPeriod = getSelectedUtilizationPeriod(sheet);
  
  const filters = getDashboardFilters(sheet);
  buildDashboardShell(sheet, filters);
  
  // Calculate stats for all time periods at once
  const allPeriodStats = getAllPeriodPMStats(filters.platform);
  
  // Draw the time period cards with selection highlight
  drawTimePeriodCards(sheet, allPeriodStats, selectedPeriod);
  
  // Cache all period chart data in hidden cells for fast switching
  cacheAllPeriodChartData(sheet, allPeriodStats);
  
  // Use selected period's weekly data for the QC cycle chart
  const selectedPeriodData = allPeriodStats[selectedPeriod];
  const chartWeeklyPmData = selectedPeriodData.weekly;
  
  // Get ALL data (unfiltered) for caching - we'll cache all period variations
  const trStatsAll = getTestRailStatsFromExecution(filters.platform, null);
  const dailyAutomatedMapAll = getDailyAutomationHistoryMap(filters.platform, null);
  
  // Cache automation and utilization chart data for all periods
  cacheAutomationChartData(sheet, dailyAutomatedMapAll);
  cacheUtilizationChartData(sheet, trStatsAll.weeklyExecution);
  
  // Get stats filtered by each section's selected period for display
  const automationStartDate = getPeriodStartDate(selectedAutomationPeriod);
  const utilizationStartDate = getPeriodStartDate(selectedUtilizationPeriod);
  const trStats = getTestRailStatsFromExecution(filters.platform, utilizationStartDate);
  const automationStats = getAutomationStats(filters.platform);
  const dailyAutomatedMap = getDailyAutomationHistoryMap(filters.platform, automationStartDate);
  const chartSeries = buildChartSeries(dailyAutomatedMap, trStats.weeklyExecution, chartWeeklyPmData, selectedAutomationPeriod, selectedUtilizationPeriod);
  const dailySummary = getDailyAutomationSummary(chartSeries.dailyRows);
  
  // Get date ranges for each section
  const dateRanges = getDataDateRanges();

  drawTopCards(sheet, allPeriodStats[selectedPeriod], dailySummary, trStats, automationStats, dateRanges, selectedPeriod, selectedAutomationPeriod, selectedUtilizationPeriod);

  // Generate chart data using the same logic as the fast update functions
  // This ensures initial load matches what dynamic filter updates show
  const tz = Session.getScriptTimeZone();
  
  // 1. QC Cycle Time chart - use cached data
  const cacheInfo = PERIOD_CACHE_COLS[selectedPeriod];
  var qcCycleRowCount = 0;
  if (cacheInfo) {
    const cacheCol = cacheInfo.start;
    const rowCount = sheet.getRange(1, cacheCol).getValue() || 0;
    if (rowCount > 0) {
      const cachedData = sheet.getRange(2, cacheCol, rowCount + 1, 2).getValues();
      sheet.getRange("AB2:AC300").clearContent();
      sheet.getRange(2, 28, cachedData.length, 1).setNumberFormat("@");
      sheet.getRange(2, 28, cachedData.length, 2).setValues(cachedData);
      qcCycleRowCount = rowCount;
    }
  }
  
  // 2. Automation Progress chart - use same logic as updateAutomationChartFast
  const automationChartRows = buildAutomationChartData(dailyAutomatedMapAll, selectedAutomationPeriod, tz);
  const automationHeader = selectedAutomationPeriod === "past30Days" ? "Date" : "Month";
  sheet.getRange("T2:U2").setValues([[automationHeader, "Automated Cases"]]);
  sheet.getRange("T3:U102").clearContent();
  if (automationChartRows.length > 0) {
    const autoDataToWrite = automationChartRows.slice(0, 100);
    sheet.getRange(3, 20, autoDataToWrite.length, 1).setNumberFormat("@");
    sheet.getRange(3, 20, autoDataToWrite.length, 2).setValues(autoDataToWrite);
  }
  
  // 3. Utilization chart - use same logic as updateUtilizationChartFast
  const utilizationChartRows = buildUtilizationChartData(trStatsAll.weeklyExecution, selectedUtilizationPeriod, tz);
  const utilizationHeader = selectedUtilizationPeriod === "past30Days" ? "Date" : "Month";
  sheet.getRange("X2:Z2").setValues([[utilizationHeader, "Total Executed", "Automated Executed"]]);
  sheet.getRange("X3:Z52").clearContent();
  if (utilizationChartRows.length > 0) {
    const utilDataToWrite = utilizationChartRows.slice(0, 50);
    sheet.getRange(3, 24, utilDataToWrite.length, 1).setNumberFormat("@");
    sheet.getRange(3, 24, utilDataToWrite.length, 3).setValues(utilDataToWrite);
  }
  
  drawCharts(sheet, automationChartRows.length, utilizationChartRows.length, qcCycleRowCount, selectedPeriod, selectedAutomationPeriod, selectedUtilizationPeriod);

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  sheet.getRange("B2").setValue("Last Refreshed: " + now).setFontColor(APP_CONFIG.COLORS.MUTED).setFontSize(10);
  
  // Ensure selected periods are stored
  setSelectedPeriod(sheet, selectedPeriod);
  setSelectedAutomationPeriod(sheet, selectedAutomationPeriod);
  setSelectedUtilizationPeriod(sheet, selectedUtilizationPeriod);
}

function buildDashboardShell(sheet, selectedFilters) {
  sheet.clear();
  // Reset old merged cells/validations/filters from previous layouts.
  sheet.getRange("A1:AZ200").breakApart();
  sheet.getRange("A3:AZ3").clearDataValidations();
  // Remove all checkboxes from dashboard area
  sheet.getRange("A1:N100").removeCheckboxes();
  const activeFilter = sheet.getFilter();
  if (activeFilter) {
    activeFilter.remove();
  }
  sheet.getRange("A1:AZ200").setBackground(APP_CONFIG.COLORS.BG);
  sheet.setFrozenRows(1);
  
  // Set consistent column widths for alignment
  // Column A: narrow margin
  sheet.setColumnWidth(1, 20);
  // Columns B-N: main content area (13 columns x 110px = 1430px total)
  sheet.setColumnWidths(2, 13, 110);
  // Column O onwards: hidden data columns
  sheet.setColumnWidths(15, 20, 80);
  
  // Set row heights for better visual spacing
  sheet.setRowHeight(1, 45);  // Title row
  sheet.setRowHeight(2, 25);  // Last refreshed
  sheet.setRowHeight(3, 10);  // Gap
  sheet.setRowHeight(4, 32);  // Section header
  sheet.setRowHeight(5, 22);  // Instruction text
  sheet.setRowHeights(6, 3, 35);  // Card rows 6-8 (taller for readability)
  sheet.setRowHeight(9, 12);  // Gap between card rows
  sheet.setRowHeights(10, 3, 35); // Card rows 10-12 (taller for readability)
  sheet.setRowHeight(13, 15); // Gap before chart
  sheet.setRowHeight(27, 12); // Gap before Automation section
  sheet.setRowHeight(28, 32); // Automation section header
  sheet.setRowHeight(29, 8);  // Gap
  sheet.setRowHeights(30, 3, 35); // Automation cards (taller)
  sheet.setRowHeight(33, 15); // Gap before chart
  sheet.setRowHeight(49, 12); // Gap before Utilization section
  sheet.setRowHeight(50, 32); // Utilization section header
  sheet.setRowHeight(51, 8);  // Gap
  sheet.setRowHeights(52, 3, 35); // Utilization cards (taller)
  sheet.setRowHeight(55, 15); // Gap before chart

  sheet.getRange("B1").setValue("QA Metrics Dashboard")
    .setFontSize(22)
    .setFontWeight("bold")
    .setFontColor(APP_CONFIG.COLORS.TEXT);

  // Time period cards will be drawn in drawTimePeriodCards() - no dropdown needed

  sheet.getCharts().forEach(function(chart) {
    sheet.removeChart(chart);
  });
}

function drawTopCards(sheet, m, s, tr, autoStats, dateRanges, selectedPeriod, selectedAutomationPeriod, selectedUtilizationPeriod) {
  const dr = dateRanges || {};
  
  // Rows 4-12: Time period cards are drawn separately by drawTimePeriodCards()
  // Row 14-26: (Reserved for QC Cycle Time Trend chart - positioned in drawCharts)
  
  // Row 28: Section heading for Automation Scripting Progress
  sheet.getRange("B28:K28").merge()
    .setValue("AUTOMATION SCRIPTING PROGRESS")
    .setFontSize(12)
    .setFontWeight("bold")
    .setFontColor(APP_CONFIG.COLORS.TEXT)
    .setBackground(APP_CONFIG.COLORS.BG)
    .setHorizontalAlignment("left")
    .setVerticalAlignment("middle");
  
  // Row 28: Period filter buttons for Automation (right side)
  drawMiniPeriodFilters(sheet, 28, 12, "automation", selectedAutomationPeriod);
  
  // Row 30-32: Automation Progress cards (5 cards, each 2 cols wide)
  drawSimpleStatCard(
    sheet,
    "B30:C32",
    "Total Test Cases",
    String(autoStats.totalTestCases || 0),
    "#6B7280"  // Gray
  );
  drawSimpleStatCard(
    sheet,
    "D30:E32",
    "Total Automatable",
    String(autoStats.totalAutomatable || 0),
    "#0EA5E9"  // Sky blue
  );
  drawSimpleStatCard(
    sheet,
    "F30:G32",
    "Total Automated",
    String(autoStats.totalAutomated || 0),
    "#22C55E"  // Green
  );
  drawSimpleStatCard(
    sheet,
    "H30:I32",
    "To Be Automated",
    String(autoStats.toBeAutomated || 0),
    "#F97316"  // Orange
  );
  drawSimpleStatCard(
    sheet,
    "J30:K32",
    "Automation %",
    formatNum(autoStats.automationPct || 0, 1) + "%",
    "#EC4899"  // Pink
  );

  // Row 34-48: (Reserved for daily automation chart - positioned in drawCharts)

  // Row 50: Section heading for Utilization of Automated Cases
  sheet.getRange("B50:K50").merge()
    .setValue("UTILIZATION OF AUTOMATED CASES")
    .setFontSize(12)
    .setFontWeight("bold")
    .setFontColor(APP_CONFIG.COLORS.TEXT)
    .setBackground(APP_CONFIG.COLORS.BG)
    .setHorizontalAlignment("left")
    .setVerticalAlignment("middle");
  
  // Row 50: Period filter buttons for Utilization (right side)
  drawMiniPeriodFilters(sheet, 50, 12, "utilization", selectedUtilizationPeriod);

  // Row 52-54: Test Execution cards (3 cards, even widths)
  // Add 6570 hardcoded to manual executions (historical data not in TestRail)
  const adjustedManualRuns = (tr.manualRuns || 0) + 6570;
  // Add 980 hardcoded to automated executions (historical data not in TestRail)
  const adjustedAutoRuns = (tr.autoRuns || 0) + 980;
  const totalExecutions = adjustedManualRuns + adjustedAutoRuns;
  const adjustedAutoPct = totalExecutions > 0 ? (adjustedAutoRuns / totalExecutions) * 100 : 0;
  
  drawSimpleStatCard(
    sheet,
    "B52:D54",
    "Manual Executions",
    String(adjustedManualRuns),
    "#F97316"  // Orange
  );
  drawSimpleStatCard(
    sheet,
    "E52:G54",
    "Automated Executions",
    String(adjustedAutoRuns),
    "#3B82F6"  // Blue
  );
  drawSimpleStatCard(
    sheet,
    "H52:K54",
    "Automation Coverage %",
    formatNum(adjustedAutoPct, 1) + "%",
    "#8B5CF6"  // Purple
  );
}

function drawCard(sheet, a1, title, value, color) {
  const r = sheet.getRange(a1);
  r.breakApart();
  r.setBackground(APP_CONFIG.COLORS.CARD)
    .setBorder(true, true, true, true, true, true, APP_CONFIG.COLORS.BORDER, SpreadsheetApp.BorderStyle.SOLID)
    .setVerticalAlignment("middle");

  const startRow = r.getRow();
  const startCol = r.getColumn();
  const numRows = r.getNumRows();
  const numCols = r.getNumColumns();

  // Merge first row for card title with colored top bar
  const titleRange = sheet.getRange(startRow, startCol, 1, numCols);
  titleRange.merge().setValue(title)
    .setBackground(color)
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setFontSize(10)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  // Merge remaining rows for large metric value
  const valueRows = Math.max(numRows - 1, 1);
  const valueRange = sheet.getRange(startRow + 1, startCol, valueRows, numCols);
  valueRange.merge().setValue(value)
    .setFontColor(color)
    .setFontWeight("bold")
    .setFontSize(20)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
}

function drawMetricCard(sheet, a1, title, mainValue, line2, line3, accent) {
  const r = sheet.getRange(a1);
  r.breakApart();
  
  const row = r.getRow();
  const col = r.getColumn();
  const cols = r.getNumColumns();
  const numRows = r.getNumRows();

  // If no line2/line3, use compact layout (title + value only)
  if (!line2 && !line3) {
    // Title row
    sheet.getRange(row, col, 1, cols).merge()
      .setValue(title)
      .setBackground(accent)
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");

    // Value takes remaining rows
    sheet.getRange(row + 1, col, numRows - 1, cols).merge()
      .setValue(mainValue)
      .setFontColor(accent)
      .setFontWeight("bold")
      .setFontSize(22)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setBackground(APP_CONFIG.COLORS.CARD)
      .setBorder(true, true, true, true, true, true, APP_CONFIG.COLORS.BORDER, SpreadsheetApp.BorderStyle.SOLID);
  } else {
    // Full layout with line2 and line3
    r.setBackground(APP_CONFIG.COLORS.CARD)
      .setBorder(true, true, true, true, true, true, APP_CONFIG.COLORS.BORDER, SpreadsheetApp.BorderStyle.SOLID);

    sheet.getRange(row, col, 1, cols).merge()
      .setValue(title)
      .setBackground(accent)
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");

    sheet.getRange(row + 1, col, 2, cols).merge()
      .setValue(mainValue)
      .setFontColor(accent)
      .setFontWeight("bold")
      .setFontSize(22)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setBackground(APP_CONFIG.COLORS.CARD);

    sheet.getRange(row + 3, col, 1, cols).merge()
      .setValue(line2)
      .setFontColor(APP_CONFIG.COLORS.MUTED)
      .setHorizontalAlignment("center")
      .setBackground(APP_CONFIG.COLORS.CARD);

    sheet.getRange(row + 4, col, 1, cols).merge()
      .setValue(line3)
      .setFontColor(APP_CONFIG.COLORS.MUTED)
      .setHorizontalAlignment("center")
      .setBackground(APP_CONFIG.COLORS.CARD);
  }
}

function drawSimpleStatCard(sheet, a1, title, value, accent) {
  const r = sheet.getRange(a1);
  r.breakApart();
  r.setBackground(APP_CONFIG.COLORS.CARD)
    .setBorder(true, true, true, true, false, false, APP_CONFIG.COLORS.BORDER, SpreadsheetApp.BorderStyle.SOLID);

  const row = r.getRow();
  const col = r.getColumn();
  const cols = r.getNumColumns();

  // Header row - centered with white text on accent background
  sheet.getRange(row, col, 1, cols).merge()
    .setValue(title)
    .setBackground(accent)
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setFontSize(10)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);

  // Value rows - large centered number
  sheet.getRange(row + 1, col, 2, cols).merge()
    .setValue(value)
    .setBackground(APP_CONFIG.COLORS.CARD)
    .setFontColor(accent)
    .setFontWeight("bold")
    .setFontSize(22)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
}

// Mini period filter options (compact version for section headers)
var MINI_PERIOD_OPTIONS = [
  { key: "allTime", label: "All", days: null },
  { key: "pastYear", label: "1Y", days: 365 },
  { key: "past6Months", label: "6M", days: 180 },
  { key: "pastQuarter", label: "3M", days: 90 },
  { key: "past30Days", label: "30D", days: 30 }
];

function drawMiniPeriodFilters(sheet, row, startCol, sectionType, selectedPeriod) {
  // Draw a single dropdown cell for period selection
  const options = MINI_PERIOD_OPTIONS;
  const labels = options.map(function(opt) { return opt.label; });
  
  // Merge cells for the dropdown
  const dropdownRange = sheet.getRange(row, startCol, 1, options.length);
  dropdownRange.merge();
  
  // Find current label from selectedPeriod key
  var currentLabel = "All";
  for (var i = 0; i < options.length; i++) {
    if (options[i].key === selectedPeriod) {
      currentLabel = options[i].label;
      break;
    }
  }
  
  // Create data validation dropdown
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(labels, true)
    .setAllowInvalid(false)
    .build();
  
  dropdownRange.setDataValidation(rule)
    .setValue(currentLabel)
    .setBackground("#3B82F6")
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setFontSize(10)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setBorder(true, true, true, true, false, false, "#60A5FA", SpreadsheetApp.BorderStyle.SOLID);
}

function getPeriodKeyFromLabel(label) {
  const options = MINI_PERIOD_OPTIONS;
  for (var i = 0; i < options.length; i++) {
    if (options[i].label === label) {
      return options[i].key;
    }
  }
  return "allTime";
}

function getPeriodLabel(periodKey) {
  const labels = {
    allTime: "All Time",
    pastYear: "Past Year",
    past6Months: "Past 6 Months",
    pastQuarter: "Past Quarter",
    past30Days: "Past 30 Days",
    pastWeek: "Past Week"
  };
  return labels[periodKey] || "All Time";
}

function getSelectedAutomationPeriod(sheet) {
  const val = sheet.getRange("AA2").getValue();
  return val || "allTime";
}

function setSelectedAutomationPeriod(sheet, periodKey) {
  sheet.getRange("AA2").setValue(periodKey);
}

function getSelectedUtilizationPeriod(sheet) {
  const val = sheet.getRange("AA3").getValue();
  return val || "allTime";
}

function setSelectedUtilizationPeriod(sheet, periodKey) {
  sheet.getRange("AA3").setValue(periodKey);
}

// Cache automation chart data for all periods in hidden columns (BA-BZ)
function cacheAutomationChartData(sheet, dailyAutomatedMap) {
  const tz = Session.getScriptTimeZone();
  const periods = ["allTime", "pastYear", "past6Months", "pastQuarter", "past30Days"];
  
  // Store raw daily data in BA:BB (date, count) - up to 500 rows
  const dailyKeys = Object.keys(dailyAutomatedMap || {}).sort();
  sheet.getRange("BA1").setValue("AUTOMATION_RAW_DATA");
  sheet.getRange("BA2:BB502").clearContent();
  
  if (dailyKeys.length > 0) {
    const rawData = dailyKeys.map(function(k) {
      return [k, Number(dailyAutomatedMap[k] || 0)];
    });
    sheet.getRange(2, 53, Math.min(rawData.length, 500), 2).setValues(rawData.slice(0, 500));
  }
}

// Cache utilization chart data for all periods in hidden columns (BC-BF)
function cacheUtilizationChartData(sheet, weeklyExecutionMap) {
  const tz = Session.getScriptTimeZone();
  
  // Store raw weekly data in BC:BE (weekKey, totalExecuted, automatedExecuted) - up to 200 rows
  const weeklyKeys = Object.keys(weeklyExecutionMap || {}).sort();
  sheet.getRange("BC1").setValue("UTILIZATION_RAW_DATA");
  sheet.getRange("BC2:BE202").clearContent();
  
  if (weeklyKeys.length > 0) {
    const rawData = weeklyKeys.map(function(k) {
      const w = weeklyExecutionMap[k] || { totalExecuted: 0, automatedExecuted: 0 };
      return [k, w.totalExecuted, w.automatedExecuted];
    });
    sheet.getRange(2, 55, Math.min(rawData.length, 200), 3).setValues(rawData.slice(0, 200));
  }
}

// Fast update for automation chart - modifies existing chart in place
function updateAutomationChartFast(sheet, periodKey) {
  const tz = Session.getScriptTimeZone();
  const chartWidth = 1430;
  const chartHeight = 250;
  
  // Read the original raw data from BA:BB (cached during initial load)
  // If not available, fetch fresh
  var dailyAutomatedMap = {};
  
  // First try to read from cache
  const rawRange = sheet.getRange("BA2:BB502").getValues();
  for (var i = 0; i < rawRange.length; i++) {
    const key = rawRange[i][0];
    const count = rawRange[i][1];
    if (key && key !== "" && String(key).trim() !== "") {
      const keyStr = String(key).trim();
      // Handle date objects
      if (key instanceof Date) {
        dailyAutomatedMap[Utilities.formatDate(key, tz, "yyyy-MM-dd")] = Number(count || 0);
      } else {
        dailyAutomatedMap[keyStr] = Number(count || 0);
      }
    }
  }
  
  // If cache is empty, fetch fresh data
  if (Object.keys(dailyAutomatedMap).length === 0) {
    const filters = getDashboardFilters(sheet);
    dailyAutomatedMap = getDailyAutomationHistoryMap(filters.platform, null);
    // Cache it for next time
    if (Object.keys(dailyAutomatedMap).length > 0) {
      cacheAutomationChartData(sheet, dailyAutomatedMap);
      SpreadsheetApp.flush();
    }
  }
  
  // Log for debugging
  Logger.log("updateAutomationChartFast: dailyAutomatedMap has " + Object.keys(dailyAutomatedMap).length + " entries");
  Logger.log("updateAutomationChartFast: periodKey = " + periodKey);
  
  // Build chart data for selected period
  const chartRows = buildAutomationChartData(dailyAutomatedMap, periodKey, tz);
  
  Logger.log("updateAutomationChartFast: chartRows has " + chartRows.length + " rows");
  
  // Determine chart title
  const periodLabels = {
    allTime: "All Time", pastYear: "Past Year", past6Months: "Past 6 Months",
    pastQuarter: "Past Quarter (3M)", past30Days: "Past 30 Days"
  };
  const periodLabel = periodLabels[periodKey] || "All Time";
  var chartTitle = periodKey === "past30Days" 
    ? "Daily Automation Progress - " + periodLabel
    : "Monthly Automation Progress - " + periodLabel;
  
  // Update header and clear data range
  const header = periodKey === "past30Days" ? "Date" : "Month";
  sheet.getRange("T2:U2").setValues([[header, "Automated Cases"]]);
  sheet.getRange("T3:U102").clearContent();
  
  // Write data if available
  var dataRowCount = 0;
  if (chartRows.length > 0) {
    const dataToWrite = chartRows.slice(0, 100);
    dataRowCount = dataToWrite.length;
    sheet.getRange(3, 20, dataToWrite.length, 1).setNumberFormat("@");
    sheet.getRange(3, 20, dataToWrite.length, 2).setValues(dataToWrite);
  } else {
    // No data for this period - show a placeholder row
    dataRowCount = 1;
    sheet.getRange(3, 20, 1, 2).setValues([["No data", 0]]);
  }
  
  // Flush to ensure data is written before chart reads it
  SpreadsheetApp.flush();
  
  // Find existing chart at row 34
  const charts = sheet.getCharts();
  var existingChart = null;
  for (var j = 0; j < charts.length; j++) {
    const chart = charts[j];
    const anchor = chart.getContainerInfo();
    if (anchor && anchor.getAnchorRow() === 34) {
      existingChart = chart;
      break;
    }
  }
  
  // Remove old chart and create new one with updated data range
  if (existingChart) {
    sheet.removeChart(existingChart);
  }
  
  // Create new chart with correct data range (header row + data rows)
  const dataEndRow = 2 + dataRowCount;
  const dailyRange = sheet.getRange("T2:U" + dataEndRow);
  const newChart = sheet.newChart()
    .asColumnChart()
    .addRange(dailyRange)
    .setPosition(34, 2, 0, 0)
    .setOption("width", chartWidth)
    .setOption("height", chartHeight)
    .setOption("title", chartTitle)
    .setOption("backgroundColor", APP_CONFIG.COLORS.CARD)
    .setOption("legend", { position: "none" })
    .setOption("hAxis", { textStyle: { color: APP_CONFIG.COLORS.TEXT }, slantedText: true, slantedTextAngle: 45 })
    .setOption("vAxis", { textStyle: { color: APP_CONFIG.COLORS.TEXT }, minValue: 0 })
    .setOption("titleTextStyle", { color: APP_CONFIG.COLORS.TEXT, fontSize: 14 })
    .setOption("annotations", { alwaysOutside: true, textStyle: { color: APP_CONFIG.COLORS.TEXT, fontSize: 11 } })
    .setOption("series", { 0: { dataLabel: "value" } })
    .build();
  sheet.insertChart(newChart);
  
  // Update filter dropdown display
  updateMiniFilterHighlight(sheet, 28, periodKey);
}

// Fast update for utilization chart - modifies existing chart in place
function updateUtilizationChartFast(sheet, periodKey) {
  const tz = Session.getScriptTimeZone();
  const chartWidth = 1430;
  const chartHeight = 250;
  
  // Always fetch fresh data to ensure accuracy
  const filters = getDashboardFilters(sheet);
  const trStats = getTestRailStatsFromExecution(filters.platform, null);
  const weeklyExecutionMap = trStats.weeklyExecution || {};
  
  // Build chart data for selected period
  const chartRows = buildUtilizationChartData(weeklyExecutionMap, periodKey, tz);
  
  // Determine chart title
  const periodLabels = {
    allTime: "All Time", pastYear: "Past Year", past6Months: "Past 6 Months",
    pastQuarter: "Past Quarter (3M)", past30Days: "Past 30 Days"
  };
  const periodLabel = periodLabels[periodKey] || "All Time";
  var chartTitle = periodKey === "past30Days"
    ? "Daily Executed Cases - " + periodLabel + " (Total vs Automated)"
    : "Monthly Executed Cases - " + periodLabel + " (Total vs Automated)";
  
  // Update header and clear data range
  const header = periodKey === "past30Days" ? "Date" : "Month";
  sheet.getRange("X2:Z2").setValues([[header, "Total Executed", "Automated Executed"]]);
  sheet.getRange("X3:Z52").clearContent();
  
  // Write data if available
  var dataRowCount = 0;
  if (chartRows.length > 0) {
    const dataToWrite = chartRows.slice(0, 50);
    dataRowCount = dataToWrite.length;
    sheet.getRange(3, 24, dataToWrite.length, 1).setNumberFormat("@");
    sheet.getRange(3, 24, dataToWrite.length, 3).setValues(dataToWrite);
  } else {
    // No data for this period - show a placeholder row
    dataRowCount = 1;
    sheet.getRange(3, 24, 1, 3).setValues([["No data", 0, 0]]);
  }
  
  // Flush to ensure data is written before chart reads it
  SpreadsheetApp.flush();
  
  // Find existing chart at row 56
  const charts = sheet.getCharts();
  var existingChart = null;
  for (var j = 0; j < charts.length; j++) {
    const chart = charts[j];
    const anchor = chart.getContainerInfo();
    if (anchor && anchor.getAnchorRow() === 56) {
      existingChart = chart;
      break;
    }
  }
  
  // Remove old chart and create new one with updated data range
  if (existingChart) {
    sheet.removeChart(existingChart);
  }
  
  // Create new chart with correct data range (header row + data rows)
  const dataEndRow = 2 + dataRowCount;
  const weeklyRange = sheet.getRange("X2:Z" + dataEndRow);
  const newChart = sheet.newChart()
    .asLineChart()
    .addRange(weeklyRange)
    .setPosition(56, 2, 0, 0)
    .setOption("width", chartWidth)
    .setOption("height", chartHeight)
    .setOption("title", chartTitle)
    .setOption("backgroundColor", APP_CONFIG.COLORS.CARD)
    .setOption("legend", { position: "top", textStyle: { color: APP_CONFIG.COLORS.TEXT } })
    .setOption("hAxis", { textStyle: { color: APP_CONFIG.COLORS.TEXT } })
    .setOption("vAxis", { textStyle: { color: APP_CONFIG.COLORS.TEXT } })
    .setOption("titleTextStyle", { color: APP_CONFIG.COLORS.TEXT })
    .build();
  sheet.insertChart(newChart);
  
  // Update filter dropdown display
  updateMiniFilterHighlight(sheet, 50, periodKey);
}

// Update dropdown display after selection change
function updateMiniFilterHighlight(sheet, row, selectedPeriod) {
  // Find label from period key
  var currentLabel = "All";
  const options = MINI_PERIOD_OPTIONS;
  for (var i = 0; i < options.length; i++) {
    if (options[i].key === selectedPeriod) {
      currentLabel = options[i].label;
      break;
    }
  }
  
  // Update the dropdown cell value
  sheet.getRange(row, 12).setValue(currentLabel);
}

function getPeriodStartDate(periodKey) {
  if (!periodKey || periodKey === "allTime") return null;
  const now = new Date();
  const periodDays = {
    pastYear: 365,
    past6Months: 180,
    pastQuarter: 90,
    past30Days: 30,
    pastWeek: 7
  };
  const days = periodDays[periodKey];
  if (!days) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

// Different colors for each time period card
var PERIOD_COLORS = {
  pastWeek: "#3B82F6",      // Blue
  past30Days: "#10B981",    // Green
  pastQuarter: "#8B5CF6",   // Purple
  past6Months: "#F59E0B",   // Amber
  pastYear: "#EC4899",      // Pink
  allTime: "#06B6D4"        // Cyan
};

function drawTimePeriodCard(sheet, a1, periodKey, label, qcDays, testDays, isSelected) {
  try {
    const r = sheet.getRange(a1);
    r.breakApart();
    
    const row = r.getRow();
    const col = r.getColumn();
    const cols = r.getNumColumns();
    
    // Get unique color for this period
    const periodColor = PERIOD_COLORS[periodKey] || APP_CONFIG.COLORS.BLUE;
    
    // Highlight styling if selected
    const borderColor = isSelected ? "#FFFFFF" : APP_CONFIG.COLORS.BORDER;
    const borderStyle = isSelected ? SpreadsheetApp.BorderStyle.SOLID_THICK : SpreadsheetApp.BorderStyle.SOLID;
    const cardBg = APP_CONFIG.COLORS.CARD;
    
    // Set card background and border
    r.setBackground(cardBg)
     .setBorder(true, true, true, true, false, false, borderColor, borderStyle);
    
    const titleBg = periodColor;
    
    // Title row: Clear any existing checkboxes and set background
    const titleRow = sheet.getRange(row, col, 1, cols);
    titleRow.removeCheckboxes();  // Remove any existing checkboxes first
    titleRow.setBackground(titleBg);
    
    // First cell: checkbox on the left
    const checkboxCell = sheet.getRange(row, col, 1, 1);
    checkboxCell.insertCheckboxes()
      .setValue(isSelected)
      .setBackground(titleBg)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");
    
    // Remaining columns: merge for centered header text
    if (cols > 1) {
      sheet.getRange(row, col + 1, 1, cols - 1).merge()
        .setValue(label || periodKey)
        .setBackground(titleBg)
        .setFontColor("#FFFFFF")
        .setFontWeight("bold")
        .setFontSize(12)
        .setHorizontalAlignment("center")
        .setVerticalAlignment("middle");
    }
    
    // QC Cycle row (merge all columns) - center aligned with larger font
    sheet.getRange(row + 1, col, 1, cols).merge()
      .setValue("QC Cycle: " + formatNum(qcDays || 0, 1) + " days")
      .setFontColor(periodColor)
      .setFontWeight("bold")
      .setFontSize(13)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setBackground(cardBg);
    
    // Test Cycle row (merge all columns) - center aligned with larger font
    sheet.getRange(row + 2, col, 1, cols).merge()
      .setValue("Test Cycle: " + formatNum(testDays || 0, 1) + " days")
      .setFontColor("#A78BFA")
      .setFontWeight("bold")
      .setFontSize(13)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setBackground(cardBg);
      
    // Add selected indicator - light tint on card background if selected
    if (isSelected) {
      sheet.getRange(row + 1, col, 2, cols).setBackground("#1E293B");
    }
  } catch (err) {
    Logger.log("drawTimePeriodCard error for " + a1 + ": " + err.message);
  }
}

function drawTimePeriodCards(sheet, allPeriodStats, selectedPeriod) {
  // Ensure allPeriodStats has defaults for all periods
  const defaultPeriod = { label: "", avgQcCycle: 0, avgTestCycle: 0, weekly: {}, startDate: null };
  const stats = allPeriodStats || {};
  const pastWeek = stats.pastWeek || defaultPeriod;
  const past30Days = stats.past30Days || defaultPeriod;
  const pastQuarter = stats.pastQuarter || defaultPeriod;
  const past6Months = stats.past6Months || defaultPeriod;
  const pastYear = stats.pastYear || defaultPeriod;
  const allTime = stats.allTime || defaultPeriod;
  
  // Section heading with better styling
  sheet.getRange("B4:M4").merge()
    .setValue("QC & TEST CYCLE TIME BY PERIOD")
    .setFontSize(14)
    .setFontWeight("bold")
    .setFontColor(APP_CONFIG.COLORS.TEXT)
    .setBackground(APP_CONFIG.COLORS.BG)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  // Instruction text
  sheet.getRange("B5:M5").merge()
    .setValue("Click checkbox to filter the trend chart")
    .setFontSize(10)
    .setFontColor(APP_CONFIG.COLORS.MUTED)
    .setBackground(APP_CONFIG.COLORS.BG)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  // All cards are same size: 4 columns wide x 3 rows tall
  // Layout: 3 cards per row with small gaps
  // Row 1: B6:E8, G6:J8, L6:O8 (but we only have up to N, so adjust)
  // Using B-M (12 columns): each card is 4 cols, no gaps needed if we use all space
  
  // Row 6-8: First row of cards (3 cards, each 4 columns)
  // Card 1: B6:E8 (cols 2-5)
  drawTimePeriodCard(sheet, "B6:E8", "pastWeek",
    pastWeek.label || "Past Week",
    pastWeek.avgQcCycle || 0,
    pastWeek.avgTestCycle || 0,
    selectedPeriod === "pastWeek"
  );
  // Card 2: F6:I8 (cols 6-9)
  drawTimePeriodCard(sheet, "F6:I8", "past30Days",
    past30Days.label || "Past 30 Days",
    past30Days.avgQcCycle || 0,
    past30Days.avgTestCycle || 0,
    selectedPeriod === "past30Days"
  );
  // Card 3: J6:M8 (cols 10-13)
  drawTimePeriodCard(sheet, "J6:M8", "pastQuarter",
    pastQuarter.label || "Past Quarter",
    pastQuarter.avgQcCycle || 0,
    pastQuarter.avgTestCycle || 0,
    selectedPeriod === "pastQuarter"
  );
  
  // Row 9: Gap row (empty)
  
  // Row 10-12: Second row of cards (3 cards, each 4 columns)
  // Card 4: B10:E12 (cols 2-5)
  drawTimePeriodCard(sheet, "B10:E12", "past6Months",
    past6Months.label || "Past 6 Months",
    past6Months.avgQcCycle || 0,
    past6Months.avgTestCycle || 0,
    selectedPeriod === "past6Months"
  );
  // Card 5: F10:I12 (cols 6-9)
  drawTimePeriodCard(sheet, "F10:I12", "pastYear",
    pastYear.label || "Past Year",
    pastYear.avgQcCycle || 0,
    pastYear.avgTestCycle || 0,
    selectedPeriod === "pastYear"
  );
  // Card 6: J10:M12 (cols 10-13)
  drawTimePeriodCard(sheet, "J10:M12", "allTime",
    allTime.label || "All Time",
    allTime.avgQcCycle || 0,
    allTime.avgTestCycle || 0,
    selectedPeriod === "allTime"
  );
}

function writeHiddenChartData(sheet, series) {
  sheet.getRange("B450:C550").clearContent();

  // Automation chart data (T:U) — FIXED 100 rows for in-place chart updates
  const automationHeader = series.automationPeriod === "past30Days" ? "Date" : "Month";
  sheet.getRange("T2:U2").setValues([[automationHeader, "Automated Cases"]]);
  sheet.getRange("T3:U102").clearContent();
  if (series.dailyRows.length > 0) {
    const out = series.dailyRows.slice(0, 100).map(function(r) {
      let label = "";
      const cell = r[0];
      if (cell instanceof Date && !isNaN(cell.getTime())) {
        const tz = Session.getScriptTimeZone();
        label = Utilities.formatDate(cell, tz, "dd-MMM");
      } else if (cell !== null && cell !== undefined && cell !== "") {
        label = String(cell).trim();
      }
      return [label, Number(r[1] || 0)];
    });
    // Set first column as text format to preserve labels
    sheet.getRange(3, 20, out.length, 1).setNumberFormat("@");
    sheet.getRange(3, 20, out.length, 2).setValues(out);
  }

  // Utilization/execution chart data (X:Z) — FIXED 50 rows for in-place chart updates
  const utilizationHeader = series.utilizationPeriod === "past30Days" ? "Week" : "Month";
  sheet.getRange("X2:Z2").setValues([[utilizationHeader, "Total Executed", "Automated Executed"]]);
  sheet.getRange("X3:Z52").clearContent();
  if (series.weeklyRows.length > 0) {
    const rows = series.weeklyRows.slice(0, 50);
    // Set first column as text format to preserve labels
    sheet.getRange(3, 24, rows.length, 1).setNumberFormat("@");
    sheet.getRange(3, 24, rows.length, 3).setValues(rows);
  }
  
  // Weekly QC Cycle Time trend (AB:AC).
  sheet.getRange("AB2:AC2").setValues([["Period", "Avg QC Cycle (days)"]]);
  sheet.getRange("AB3:AC300").clearContent();
  if (series.weeklyQcCycleRows && series.weeklyQcCycleRows.length > 0) {
    // Set first column as text format to preserve labels
    sheet.getRange(3, 28, series.weeklyQcCycleRows.length, 1).setNumberFormat("@");
    sheet.getRange(3, 28, series.weeklyQcCycleRows.length, 2).setValues(series.weeklyQcCycleRows);
  }
}

function drawCharts(sheet, dailyCount, weeklyCount, qcCycleCount, selectedPeriod, automationPeriod, utilizationPeriod) {
  // Chart width aligned with columns B-N (approximately 1430px based on column widths)
  const chartWidth = 1430;
  const chartHeight = 250;
  
  // Get period labels for all sections
  const periodLabels = {
    pastWeek: "Past Week",
    past30Days: "Past 30 Days",
    pastQuarter: "Past Quarter (3M)",
    past6Months: "Past 6 Months",
    pastYear: "Past Year",
    allTime: "All Time"
  };
  const periodLabel = periodLabels[selectedPeriod] || "All Time";
  const automationPeriodLabel = periodLabels[automationPeriod] || "All Time";
  const utilizationPeriodLabel = periodLabels[utilizationPeriod] || "All Time";
  
  // Dynamic chart title based on granularity for QC cycle
  var chartTitle = "Avg QC Cycle Time - " + periodLabel;
  if (selectedPeriod === "pastWeek" || selectedPeriod === "past30Days") {
    chartTitle = "Daily Avg QC Cycle Time - " + periodLabel;
  } else {
    // pastQuarter, past6Months, pastYear, allTime - all show monthly
    chartTitle = "Monthly Avg QC Cycle Time - " + periodLabel;
  }
  
  // Dynamic chart titles for automation and utilization
  var automationChartTitle = "Automation Progress";
  if (automationPeriod === "past30Days") {
    automationChartTitle = "Daily Automation Progress - " + automationPeriodLabel;
  } else {
    automationChartTitle = "Monthly Automation Progress - " + automationPeriodLabel;
  }
  
  var utilizationChartTitle = "Test Executions";
  if (utilizationPeriod === "past30Days") {
    utilizationChartTitle = "Daily Executed Cases - " + utilizationPeriodLabel;
  } else {
    utilizationChartTitle = "Monthly Executed Cases - " + utilizationPeriodLabel;
  }
  
  if (dailyCount <= 0 && weeklyCount <= 0 && qcCycleCount <= 0) {
    sheet.getRange("B14").setValue("No chart data. Sync TestRail to Google Sheet.")
      .setFontColor(APP_CONFIG.COLORS.MUTED);
    return;
  }

  // Row 14: QC Cycle Time Trend chart (below time period cards)
  if (qcCycleCount > 0) {
    const qcCycleEnd = 2 + qcCycleCount;
    const qcCycleRange = sheet.getRange("AB2:AC" + qcCycleEnd);
    const qcCycleChart = sheet.newChart()
      .asLineChart()
      .addRange(qcCycleRange)
      .setPosition(14, 2, 0, 0)
      .setOption("width", chartWidth)
      .setOption("height", chartHeight)
      .setOption("title", chartTitle)
      .setOption("backgroundColor", APP_CONFIG.COLORS.CARD)
      .setOption("legend", { position: "none" })
      .setOption("hAxis", { 
        textStyle: { color: APP_CONFIG.COLORS.TEXT, fontSize: 10 }, 
        slantedText: true, 
        slantedTextAngle: 45 
      })
      .setOption("vAxis", { 
        textStyle: { color: APP_CONFIG.COLORS.TEXT }, 
        minValue: 0,
        title: "Avg Days",
        titleTextStyle: { color: APP_CONFIG.COLORS.TEXT }
      })
      .setOption("titleTextStyle", { color: APP_CONFIG.COLORS.TEXT, fontSize: 14 })
      .setOption("curveType", "none")
      .setOption("pointSize", 6)
      .setOption("lineWidth", 2)
      .setOption("series", { 
        0: { 
          color: "#60A5FA",
          lineWidth: 2,
          pointSize: 6,
          pointShape: "circle",
          visibleInLegend: false
        } 
      })
      .setOption("trendlines", { 
        0: { 
          type: "linear", 
          color: "#FF6B6B", 
          lineWidth: 3,
          opacity: 0.8,
          showR2: false,
          visibleInLegend: false
        } 
      })
      .build();
    sheet.insertChart(qcCycleChart);
  }

  // Row 34: Automation progress chart (below Automation Progress cards)
  if (dailyCount > 0) {
    const dailyEndRow = Math.min(2 + dailyCount, 102);
    const dailyRange = sheet.getRange("T2:U" + dailyEndRow);
    const dailyChart = sheet.newChart()
      .asColumnChart()
      .addRange(dailyRange)
      .setPosition(34, 2, 0, 0)
      .setOption("width", chartWidth)
      .setOption("height", chartHeight)
      .setOption("title", automationChartTitle)
      .setOption("backgroundColor", APP_CONFIG.COLORS.CARD)
      .setOption("legend", { position: "none" })
      .setOption("hAxis", { textStyle: { color: APP_CONFIG.COLORS.TEXT }, slantedText: true, slantedTextAngle: 45 })
      .setOption("vAxis", { textStyle: { color: APP_CONFIG.COLORS.TEXT }, minValue: 0 })
      .setOption("titleTextStyle", { color: APP_CONFIG.COLORS.TEXT, fontSize: 14 })
      .setOption("annotations", { alwaysOutside: true, textStyle: { color: APP_CONFIG.COLORS.TEXT, fontSize: 11 } })
      .setOption("series", { 0: { dataLabel: "value" } })
      .build();
    sheet.insertChart(dailyChart);
  }

  // Row 56: Utilization/execution chart (below Test Execution cards)
  if (weeklyCount > 0) {
    const weeklyEndRow = Math.min(2 + weeklyCount, 52);
    const weeklyRange = sheet.getRange("X2:Z" + weeklyEndRow);
    const execChart = sheet.newChart()
      .asLineChart()
      .addRange(weeklyRange)
      .setPosition(56, 2, 0, 0)
      .setOption("width", chartWidth)
      .setOption("height", chartHeight)
      .setOption("title", utilizationChartTitle + " (Total vs Automated)")
      .setOption("backgroundColor", APP_CONFIG.COLORS.CARD)
      .setOption("legend", { position: "top", textStyle: { color: APP_CONFIG.COLORS.TEXT } })
      .setOption("hAxis", { textStyle: { color: APP_CONFIG.COLORS.TEXT } })
      .setOption("vAxis", { textStyle: { color: APP_CONFIG.COLORS.TEXT } })
      .setOption("titleTextStyle", { color: APP_CONFIG.COLORS.TEXT })
      .build();
    sheet.insertChart(execChart);
  }
}

function getAllPeriodPMStats(platform) {
  const now = new Date();
  const periods = [
    { key: "pastWeek", label: "Past Week", days: 7 },
    { key: "past30Days", label: "Past 30 Days", days: 30 },
    { key: "pastQuarter", label: "Past Quarter", days: 90 },
    { key: "past6Months", label: "Past 6 Months", days: 180 },
    { key: "pastYear", label: "Past Year", days: 365 },
    { key: "allTime", label: "All Time", days: null }
  ];
  
  const results = {};
  periods.forEach(function(p) {
    const startDate = p.days 
      ? new Date(now.getTime() - p.days * 24 * 60 * 60 * 1000) 
      : null;
    const stats = getPMCycleStats(startDate, platform);
    results[p.key] = {
      label: p.label,
      avgQcCycle: stats.avgQcCycleDays,
      avgTestCycle: stats.avgTestCycleDays,
      weekly: stats.weekly,
      daily: stats.daily,
      monthly: stats.monthly,
      startDate: startDate
    };
  });
  return results;
}

function getPMCycleStats(startDate, platform) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(APP_CONFIG.PM_SHEET);
  if (!sheet || sheet.getLastRow() < 4) {
    return { avgQcCycleDays: 0, avgTestCycleDays: 0, qcMedianDays: 0, completedTickets: 0, totalTickets: 0, avgCyclesPerTicket: 0, totalCycles: 0, weekly: {} };
  }

  const values = sheet.getDataRange().getValues();
  const headerRow = findHeaderRow(values, ["ticketId", "statusChangeDate", "newStatus"]);
  if (headerRow === -1) {
    return { avgQcCycleDays: 0, avgTestCycleDays: 0, qcMedianDays: 0, completedTickets: 0, totalTickets: 0, avgCyclesPerTicket: 0, totalCycles: 0, weekly: {} };
  }

  const headers = values[headerRow];
  const ticketCol = findColumn(headers, "ticketId");
  const dateCol = findColumn(headers, "statusChangeDate");
  const newStatusCol = findColumn(headers, "newStatus");
  const subDeptCol = findColumnAlias(headers, ["subDepartment", "subdepartment", "platform"]);

  if (ticketCol === -1 || dateCol === -1 || newStatusCol === -1) {
    return { avgQcCycleDays: 0, avgTestCycleDays: 0, qcMedianDays: 0, completedTickets: 0, totalTickets: 0, avgCyclesPerTicket: 0, totalCycles: 0, weekly: {} };
  }

  const eventsByTicket = {};
  for (let i = headerRow + 1; i < values.length; i++) {
    const ticketId = values[i][ticketCol];
    const status = String(values[i][newStatusCol] || "").trim();
    const dt = parseDate(values[i][dateCol]);
    if (!ticketId || !status || !dt) {
      continue;
    }
    if (!eventsByTicket[ticketId]) {
      eventsByTicket[ticketId] = [];
    }
    const subDept = subDeptCol !== -1 ? String(values[i][subDeptCol] || "").trim() : "";
    eventsByTicket[ticketId].push({ status: status, date: dt, subDept: subDept });
  }

  let qcSum = 0;
  let qcCount = 0;
  const qcList = [];
  let testSum = 0;
  let testCount = 0;
  let totalCycles = 0;
  let completedTickets = 0;
  let totalTickets = 0;
  const weekly = {};
  const daily = {};
  const monthly = {};
  const selectedPlatform = String(platform || "All");

  Object.keys(eventsByTicket).forEach(function(ticket) {
    const events = eventsByTicket[ticket].sort(function(a, b) { return a.date - b.date; });
    const ticketPlatform = resolveTicketPlatform(events);
    if (!isTicketInPlatform(ticketPlatform, selectedPlatform)) {
      return;
    }

    // Period filter controls ticket inclusion (based on activity in selected range).
    const scopedEvents = startDate
      ? events.filter(function(ev) { return ev.date >= startDate; })
      : events;
    if (scopedEvents.length === 0) {
      return;
    }
    totalTickets += 1;

    // Cycle calculations use full ticket history (legacy behavior from previous dashboard).
    let firstQcStart = null;
    let lastQcEnd = null;
    let cycles = 0;
    let cycleDurationSum = 0;
    let openCycleStart = null;

    for (let i = 0; i < events.length; i++) {
      const st = events[i].status;
      if (QC_START_STATUSES.has(st)) {
        if (!firstQcStart) {
          firstQcStart = events[i].date;
        }
        if (!openCycleStart) {
          openCycleStart = events[i].date;
        }
        cycles += 1;
      }
      if (openCycleStart && QC_END_STATUSES.has(st) && events[i].date >= openCycleStart) {
        lastQcEnd = events[i].date;
        cycleDurationSum += (events[i].date.getTime() - openCycleStart.getTime()) / (1000 * 60 * 60 * 24);
        openCycleStart = null;
      }
    }
    totalCycles += cycles;

    if (startDate && (!lastQcEnd || lastQcEnd < startDate)) {
      return;
    }

    if (firstQcStart && lastQcEnd && lastQcEnd >= firstQcStart) {
      // QC cycle: from first QA start to final QA exit for a ticket.
      const qcDays = (lastQcEnd.getTime() - firstQcStart.getTime()) / (1000 * 60 * 60 * 24);
      // Test cycle: average duration per QA cycle in this ticket.
      const testDays = cycles > 0 ? (cycleDurationSum / cycles) : 0;
      qcSum += qcDays;
      qcCount += 1;
      qcList.push(qcDays);
      testSum += testDays;
      testCount += 1;
      completedTickets += 1;

      const wk = weekKey(lastQcEnd);
      if (!weekly[wk]) {
        weekly[wk] = { qcSum: 0, qcCount: 0, testSum: 0, testCount: 0 };
      }
      weekly[wk].qcSum += qcDays;
      weekly[wk].qcCount += 1;
      weekly[wk].testSum += testDays;
      weekly[wk].testCount += 1;
      
      // Also track daily aggregation
      const dy = dayKey(lastQcEnd);
      if (!daily[dy]) {
        daily[dy] = { qcSum: 0, qcCount: 0 };
      }
      daily[dy].qcSum += qcDays;
      daily[dy].qcCount += 1;
      
      // Also track monthly aggregation
      const mo = monthKey(lastQcEnd);
      if (!monthly[mo]) {
        monthly[mo] = { qcSum: 0, qcCount: 0 };
      }
      monthly[mo].qcSum += qcDays;
      monthly[mo].qcCount += 1;
    }
  });

  return {
    avgQcCycleDays: qcCount ? qcSum / qcCount : 0,
    avgTestCycleDays: testCount ? testSum / testCount : 0,
    qcMedianDays: median(qcList),
    completedTickets: completedTickets,
    totalTickets: totalTickets,
    avgCyclesPerTicket: totalTickets ? totalCycles / totalTickets : 0,
    totalCycles: totalCycles,
    weekly: weekly,
    daily: daily,
    monthly: monthly
  };
}

function getTestRailStatsFromExecution(platform, startDate) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(APP_CONFIG.TESTRAIL_EXEC_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    return {
      automatedCases: 0,
      manualRuns: 0,
      autoRuns: 0,
      autoPct: 0,
      weekly: {},
      weeklyExecution: {}
    };
  }

  const data = sheet.getDataRange().getValues();
  const headerRow = findHeaderRow(data, [
    "Execution Method",
    "Suite ID",
    "Executed On",
    "Status ID",
    "Case ID"
  ]);
  const h = headerRow === -1 ? 0 : headerRow;
  const headers = data[h];
  const methodCol = findColumn(headers, "Execution Method");
  const statusCol = findColumn(headers, "Status ID");
  const executedCol = findColumn(headers, "Executed On");
  const suiteCol = findColumn(headers, "Suite ID");
  const caseIdCol = findColumn(headers, "Case ID");
  /** Cases marked automated on TestRail_Cases (Automation Status or Execution Method). */
  const automatedCaseIds = getCurrentlyAutomatedCaseIds(platform);
  if (methodCol === -1 || statusCol === -1 || executedCol === -1 || suiteCol === -1) {
    return {
      automatedCases: 0,
      manualRuns: 0,
      autoRuns: 0,
      autoPct: 0,
      weekly: {},
      weeklyExecution: {}
    };
  }

  let automatedCases = 0;
  let manualRuns = 0;
  let autoRuns = 0;
  const weekly = {};
  const weeklyExecution = {};

  for (let i = h + 1; i < data.length; i++) {
    const suiteId = String(data[i][suiteCol] || "");
    if (platform === "Web" && suiteId && suiteId !== "137") {
      continue;
    }
    if (platform === "Mobile" && suiteId && suiteId !== "847") {
      continue;
    }

    const method = data[i][methodCol];
    const status = data[i][statusCol];
    const isExecuted = isExecutedStatus(status);
    const executed = parseDate(data[i][executedCol]);
    if (!isExecuted) {
      continue;
    }

    const caseId = caseIdCol !== -1 ? String(data[i][caseIdCol] || "").trim() : "";
    const caseIsAutomated = caseId !== "" && automatedCaseIds[caseId];
    const rowIsAutomated = executionMethodIs(method, "Automated");
    const countAsAutomated = rowIsAutomated || caseIsAutomated;
    const countAsManual = executionMethodIs(method, "Manual") && !countAsAutomated;

    const inPeriod = !startDate || (executed && executed >= startDate);
    if (countAsManual && inPeriod) {
      manualRuns += 1;
    }
    if (countAsAutomated && inPeriod) {
      autoRuns += 1;
      automatedCases += 1;
    }

    if (executed) {
      const wk = weekKey(executed);
      if (!weekly[wk]) {
        weekly[wk] = { automatedCases: 0, manualRuns: 0, autoRuns: 0 };
      }
      if (!startDate || executed >= startDate) {
        if (countAsManual) {
          weekly[wk].manualRuns += 1;
        }
        if (countAsAutomated) {
          weekly[wk].autoRuns += 1;
          weekly[wk].automatedCases += 1;
        }
      }

      if (!startDate || executed >= startDate) {
        if (!weeklyExecution[wk]) {
          weeklyExecution[wk] = { totalExecuted: 0, automatedExecuted: 0 };
        }
        if (countAsManual || countAsAutomated) {
          weeklyExecution[wk].totalExecuted += 1;
        }
        if (countAsAutomated) {
          weeklyExecution[wk].automatedExecuted += 1;
        }
      }
    }
  }

  const totalRuns = manualRuns + autoRuns;
  return {
    automatedCases: automatedCases,
    manualRuns: manualRuns,
    autoRuns: autoRuns,
    autoPct: totalRuns ? (autoRuns * 100.0 / totalRuns) : 0,
    weekly: weekly,
    weeklyExecution: weeklyExecution
  };
}

function isExecutedStatus(statusVal) {
  const raw = String(statusVal || "").trim();
  if (!raw) return false;
  const normalized = raw.toLowerCase();
  // TestRail statuses: 1=Passed, 2=Blocked, 3=Untested, 4=Retest, 5=Failed
  // Only count Passed (1), Failed (5), and Retest (4) as executed
  // Blocked (2) and Untested (3) are NOT executed
  return normalized === "1" || normalized === "5" || normalized === "4" 
      || normalized === "passed" || normalized === "failed" || normalized === "retest";
}

function isAutomationStatusAutomated(val) {
  return String(val || "").trim().toLowerCase() === "automated";
}

/** Align with backend automation metrics: either field can mark the case as automated. */
function isCaseAutomated(automationStatusVal, executionMethodVal) {
  return (
    isAutomationStatusAutomated(automationStatusVal) ||
    executionMethodIs(executionMethodVal, "Automated")
  );
}

function executionMethodIs(val, kind) {
  const s = String(val || "").trim().toLowerCase();
  return s === String(kind).toLowerCase();
}

function getDailyAutomatedFromCases(platform, startDate) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(APP_CONFIG.TESTRAIL_SHEET);
  const out = {};
  if (!sheet || sheet.getLastRow() < 2) {
    return out;
  }

  const data = sheet.getDataRange().getValues();
  const headerRow = findHeaderRow(data, ["Case ID", "Automation Status"]);
  const h = headerRow === -1 ? 0 : headerRow;
  const headers = data[h];
  const statusCol = findColumn(headers, "Automation Status");
  const methodCol = findColumn(headers, "Execution Method");
  const movedCol = findColumnAlias(headers, ["Automated On", "Updated On", "Created On"]);
  const suiteCol = findColumn(headers, "Suite ID");
  if (statusCol === -1 || movedCol === -1) {
    return out;
  }

  for (let i = h + 1; i < data.length; i++) {
    const suiteId = String(data[i][suiteCol] || "");
    if (platform === "Web" && suiteId && suiteId !== "137") {
      continue;
    }
    if (platform === "Mobile" && suiteId && suiteId !== "847") {
      continue;
    }

    const status = data[i][statusCol];
    const method = methodCol === -1 ? "" : data[i][methodCol];
    if (!isCaseAutomated(status, method)) {
      continue;
    }
    const dt = parseDate(data[i][movedCol]);
    if (!dt) {
      continue;
    }
    
    // Filter by start date if specified
    if (startDate && dt < startDate) {
      continue;
    }
    
    const key = dayKey(dt);
    out[key] = (out[key] || 0) + 1;
  }

  return out;
}

function getDailyAutomationHistoryMap(platform, startDate) {
  // Prefer Automation_History - it has accurate "First Automated Date" per case.
  const historyMap = getDailyAutomatedFromHistorySheet(platform, startDate);
  if (Object.keys(historyMap).length > 0) {
    return historyMap;
  }
  // Fallback: TestRail_Cases Updated On dates when history is empty.
  return getDailyAutomatedFromCases(platform, startDate);
}

function getDailyAutomatedFromHistorySheet(platform, startDate) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const historySheet = ss.getSheetByName("Automation_History");
  const out = {};
  if (!historySheet || historySheet.getLastRow() < 2) {
    return out;
  }

  // Get currently automated case IDs from TestRail_Cases
  const currentlyAutomatedCaseIds = getCurrentlyAutomatedCaseIds(platform);

  const data = historySheet.getDataRange().getValues();
  const headers = data[0];
  const caseIdCol = findColumn(headers, "Case ID");
  const dateCol = findColumnAlias(headers, [
    "First Automated Date",
    "Automated On",
    "Captured On",
    "Date"
  ]);
  const suiteCol = findColumn(headers, "Suite ID");
  if (dateCol === -1 || caseIdCol === -1) {
    return out;
  }

  for (let i = 1; i < data.length; i++) {
    const caseId = String(data[i][caseIdCol] || "").trim();
    
    // Only count if case is STILL automated
    if (!currentlyAutomatedCaseIds[caseId]) {
      continue;
    }
    
    // Filter by platform if specified
    if (platform && platform !== "All" && suiteCol !== -1) {
      const suiteId = String(data[i][suiteCol] || "");
      if (platform === "Web" && suiteId && suiteId !== "137") continue;
      if (platform === "Mobile" && suiteId && suiteId !== "847") continue;
    }
    const dt = parseDate(data[i][dateCol]);
    if (!dt) continue;
    
    // Filter by start date if specified
    if (startDate && dt < startDate) continue;
    
    const key = dayKey(dt);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function getCurrentlyAutomatedCaseIds(platform) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(APP_CONFIG.TESTRAIL_SHEET);
  const caseIds = {};
  
  if (!sheet || sheet.getLastRow() < 2) {
    return caseIds;
  }

  const data = sheet.getDataRange().getValues();
  const headerRow = findHeaderRow(data, ["Case ID", "Automation Status"]);
  const h = headerRow === -1 ? 0 : headerRow;
  const headers = data[h];
  const caseIdCol = findColumn(headers, "Case ID");
  const statusCol = findColumn(headers, "Automation Status");
  const methodCol = findColumn(headers, "Execution Method");
  const suiteCol = findColumn(headers, "Suite ID");
  
  if (caseIdCol === -1 || statusCol === -1) {
    return caseIds;
  }

  for (let i = h + 1; i < data.length; i++) {
    // Filter by platform if specified
    if (platform && platform !== "All" && suiteCol !== -1) {
      const suiteId = String(data[i][suiteCol] || "");
      if (platform === "Web" && suiteId && suiteId !== "137") continue;
      if (platform === "Mobile" && suiteId && suiteId !== "847") continue;
    }
    
    const method = methodCol === -1 ? "" : data[i][methodCol];
    if (isCaseAutomated(data[i][statusCol], method)) {
      const caseId = String(data[i][caseIdCol] || "").trim();
      if (caseId) {
        caseIds[caseId] = true;
      }
    }
  }
  
  return caseIds;
}

function getAutomationStats(platform) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(APP_CONFIG.TESTRAIL_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    return { totalTestCases: 0, totalAutomatable: 0, totalAutomated: 0, toBeAutomated: 0, automationPct: 0 };
  }

  const data = sheet.getDataRange().getValues();
  const headerRow = findHeaderRow(data, ["Case ID", "Automation Status"]);
  const h = headerRow === -1 ? 0 : headerRow;
  const headers = data[h];
  const statusCol = findColumn(headers, "Automation Status");
  const methodCol = findColumn(headers, "Execution Method");
  const candidateCol = findColumn(headers, "Automation Candidate");
  const suiteCol = findColumn(headers, "Suite ID");
  
  if (statusCol === -1) {
    return { totalTestCases: 0, totalAutomatable: 0, totalAutomated: 0, toBeAutomated: 0, automationPct: 0 };
  }

  let totalTestCases = 0;
  let totalAutomatable = 0;
  let totalAutomated = 0;

  for (let i = h + 1; i < data.length; i++) {
    const suiteId = String(data[i][suiteCol] || "");
    if (platform === "Web" && suiteId && suiteId !== "137") {
      continue;
    }
    if (platform === "Mobile" && suiteId && suiteId !== "847") {
      continue;
    }

    // Count all test cases
    totalTestCases += 1;

    // Count automatable cases (Automation Candidate = Yes)
    if (candidateCol !== -1) {
      const candidate = String(data[i][candidateCol] || "").trim().toLowerCase();
      if (candidate === "yes") {
        totalAutomatable += 1;
      }
    }

    // Count automated cases (Automation Status or Execution Method = Automated)
    const method = methodCol === -1 ? "" : data[i][methodCol];
    if (isCaseAutomated(data[i][statusCol], method)) {
      totalAutomated += 1;
    }
  }

  const toBeAutomated = Math.max(0, totalAutomatable - totalAutomated);
  // Automation % = Total Automated / Total Test Cases * 100
  const automationPct = totalTestCases > 0 ? (totalAutomated / totalTestCases) * 100 : 0;

  return {
    totalTestCases: totalTestCases,
    totalAutomatable: totalAutomatable,
    totalAutomated: totalAutomated,
    toBeAutomated: toBeAutomated,
    automationPct: automationPct
  };
}

function getDataDateRanges() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = Session.getScriptTimeZone();
  const result = {
    automation: "",
    execution: "",
    pm: ""
  };
  
  // Get date range from Automation_History
  const historySheet = ss.getSheetByName("Automation_History");
  if (historySheet && historySheet.getLastRow() > 1) {
    const historyData = historySheet.getDataRange().getValues();
    const historyHeaders = historyData[0];
    const dateCol = findColumnAlias(historyHeaders, ["First Automated Date", "Automated On", "Date"]);
    if (dateCol !== -1) {
      let minDate = null;
      let maxDate = null;
      for (let i = 1; i < historyData.length; i++) {
        const dt = parseDate(historyData[i][dateCol]);
        if (dt) {
          if (!minDate || dt < minDate) minDate = dt;
          if (!maxDate || dt > maxDate) maxDate = dt;
        }
      }
      if (minDate) {
        result.automation = Utilities.formatDate(minDate, tz, "dd-MMM-yyyy");
      }
    }
  }
  
  // Get date range from TestRail_Execution
  const execSheet = ss.getSheetByName(APP_CONFIG.TESTRAIL_EXEC_SHEET);
  if (execSheet && execSheet.getLastRow() > 1) {
    const execData = execSheet.getDataRange().getValues();
    const execHeaders = execData[0];
    const executedCol = findColumn(execHeaders, "Executed On");
    if (executedCol !== -1) {
      let minDate = null;
      for (let i = 1; i < execData.length; i++) {
        const dt = parseDate(execData[i][executedCol]);
        if (dt) {
          if (!minDate || dt < minDate) minDate = dt;
        }
      }
      if (minDate) {
        result.execution = Utilities.formatDate(minDate, tz, "dd-MMM-yyyy");
      }
    }
  }
  
  // Get date range from PM_Activity
  const pmSheet = ss.getSheetByName(APP_CONFIG.PM_SHEET);
  if (pmSheet && pmSheet.getLastRow() > 1) {
    const pmData = pmSheet.getDataRange().getValues();
    const pmHeaders = pmData[0];
    const dateCol = findColumn(pmHeaders, "statusChangeDate");
    if (dateCol !== -1) {
      let minDate = null;
      for (let i = 1; i < pmData.length; i++) {
        const dt = parseDate(pmData[i][dateCol]);
        if (dt) {
          if (!minDate || dt < minDate) minDate = dt;
        }
      }
      if (minDate) {
        result.pm = Utilities.formatDate(minDate, tz, "dd-MMM-yyyy");
      }
    }
  }
  
  return result;
}

function getAutomatedCaseCount(platform) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(APP_CONFIG.TESTRAIL_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    return 0;
  }

  const data = sheet.getDataRange().getValues();
  const headerRow = findHeaderRow(data, ["Case ID", "Automation Status"]);
  const h = headerRow === -1 ? 0 : headerRow;
  const headers = data[h];
  const statusCol = findColumn(headers, "Automation Status");
  const methodCol = findColumn(headers, "Execution Method");
  const suiteCol = findColumn(headers, "Suite ID");
  if (statusCol === -1 || suiteCol === -1) {
    return 0;
  }

  let count = 0;
  for (let i = h + 1; i < data.length; i++) {
    const suiteId = String(data[i][suiteCol] || "");
    if (platform === "Web" && suiteId && suiteId !== "137") {
      continue;
    }
    if (platform === "Mobile" && suiteId && suiteId !== "847") {
      continue;
    }

    const method = methodCol === -1 ? "" : data[i][methodCol];
    if (isCaseAutomated(data[i][statusCol], method)) {
      count++;
    }
  }

  return count;
}

function getDashboardFilters(sheet) {
  return { period: "All Time", platform: "All", startDate: null };
}

function buildChartSeries(dailyAutomatedMap, weeklyExecutionMap, weeklyPmStats, automationPeriod, utilizationPeriod) {
  const tz = Session.getScriptTimeZone();
  
  // Build automation chart data based on selected period
  const automationChartRows = buildAutomationChartData(dailyAutomatedMap, automationPeriod, tz);
  
  // Build utilization chart data based on selected period
  const utilizationChartRows = buildUtilizationChartData(weeklyExecutionMap, utilizationPeriod, tz);

  // Weekly QC Cycle Time trend - shows avg QC cycle time per week
  // Sort keys chronologically (yyyy-MM-dd format), current week will be last
  // Filter to show data starting from Jan 2026 onwards
  const jan2026 = new Date(2026, 0, 1); // January 1, 2026
  const pmWeeklyKeys = Object.keys(weeklyPmStats || {}).sort().filter(function(k) {
    const weekDate = parseDate(k);
    return weekDate && weekDate >= jan2026;
  });
  const weeklyQcCycleRows = pmWeeklyKeys.map(function(k) {
    const w = weeklyPmStats[k] || { qcSum: 0, qcCount: 0 };
    const weekDate = parseDate(k);
    // Use same label format as Weekly Executed Cases chart: "Mar'26 W4"
    const label = weekDate ? formatMonthWeekFromMonday(weekDate) : k;
    const avgQcDays = w.qcCount > 0 ? (w.qcSum / w.qcCount) : 0;
    return [label, Math.round(avgQcDays * 10) / 10];
  }).filter(function(row) {
    return row[1] > 0;
  });

  return { 
    dailyRows: automationChartRows, 
    weeklyRows: utilizationChartRows, 
    weeklyQcCycleRows: weeklyQcCycleRows,
    automationPeriod: automationPeriod,
    utilizationPeriod: utilizationPeriod
  };
}

function buildAutomationChartData(dailyAutomatedMap, period, tz) {
  const now = new Date();
  
  // Determine start date and granularity based on period
  var startDate = null;
  var granularity = "daily"; // daily or monthly
  var numDays = 30;
  var numMonths = 0;
  
  if (period === "past30Days") {
    startDate = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    granularity = "daily";
    numDays = 30;
  } else if (period === "pastQuarter") {
    startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    granularity = "monthly";
    numMonths = 3;
  } else if (period === "past6Months") {
    startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    granularity = "monthly";
    numMonths = 6;
  } else if (period === "pastYear") {
    startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    granularity = "monthly";
    numMonths = 12;
  } else {
    // allTime - show monthly, aggregate all available data
    granularity = "monthly";
    numMonths = 0; // Will use actual data range
  }
  
  if (granularity === "daily") {
    // Generate all 30 days from startDate to now (current date + 29 prior days)
    const rows = [];
    for (var d = 0; d < numDays; d++) {
      const date = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
      const dateKey = Utilities.formatDate(date, tz, "yyyy-MM-dd");
      const label = Utilities.formatDate(date, tz, "dd-MMM");
      const count = Number(dailyAutomatedMap[dateKey] || 0);
      rows.push([label, count]);
    }
    return rows;
  } else {
    // Monthly view - generate all months in the range
    const monthlyAgg = {};
    
    // First, aggregate existing data
    const dailyKeysAll = Object.keys(dailyAutomatedMap || {}).sort();
    dailyKeysAll.forEach(function(key) {
      const parsed = parseDate(key);
      if (!parsed) return;
      if (startDate && parsed < startDate) return;
      const mk = Utilities.formatDate(parsed, tz, "yyyy-MM");
      if (!monthlyAgg[mk]) {
        monthlyAgg[mk] = 0;
      }
      monthlyAgg[mk] += Number(dailyAutomatedMap[key] || 0);
    });
    
    // For specific periods, generate all months even if empty
    if (numMonths > 0) {
      const rows = [];
      for (var m = numMonths - 1; m >= 0; m--) {
        const monthDate = new Date(now.getFullYear(), now.getMonth() - m, 1);
        const mk = Utilities.formatDate(monthDate, tz, "yyyy-MM");
        const label = Utilities.formatDate(monthDate, tz, "MMM-yyyy");
        const count = monthlyAgg[mk] || 0;
        rows.push([label, count]);
      }
      return rows;
    } else {
      // allTime - just show months with data
      const monthKeys = Object.keys(monthlyAgg).sort();
      return monthKeys.map(function(mk) {
        const parts = mk.split("-");
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const monthDate = new Date(year, month, 1);
        const label = Utilities.formatDate(monthDate, tz, "MMM-yyyy");
        return [label, monthlyAgg[mk]];
      });
    }
  }
}

function buildUtilizationChartData(weeklyExecutionMap, period, tz) {
  const now = new Date();
  const MANUAL_EXECUTIONS_OFFSET = 6570;
  
  // Determine start date and granularity based on period
  var startDate = null;
  var granularity = "daily"; // daily or monthly
  var numDays = 30;
  var numMonths = 0;
  
  if (period === "past30Days") {
    startDate = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    granularity = "daily";
    numDays = 30; // Show all 30 days
  } else if (period === "pastQuarter") {
    startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    granularity = "monthly";
    numMonths = 3;
  } else if (period === "past6Months") {
    startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    granularity = "monthly";
    numMonths = 6;
  } else if (period === "pastYear") {
    startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    granularity = "monthly";
    numMonths = 12;
  } else {
    // allTime - show monthly
    granularity = "monthly";
    numMonths = 0;
  }
  
  // Build aggregation from existing data
  const weeklyKeys = Object.keys(weeklyExecutionMap || {}).sort();
  const monthlyAgg = {};
  
  weeklyKeys.forEach(function(k) {
    const weekDate = parseDate(k);
    if (!weekDate) return;
    if (startDate && weekDate < startDate) return;
    const mk = Utilities.formatDate(weekDate, tz, "yyyy-MM");
    if (!monthlyAgg[mk]) {
      monthlyAgg[mk] = { totalExecuted: 0, automatedExecuted: 0 };
    }
    const w = weeklyExecutionMap[k] || { totalExecuted: 0, automatedExecuted: 0 };
    monthlyAgg[mk].totalExecuted += w.totalExecuted;
    monthlyAgg[mk].automatedExecuted += w.automatedExecuted;
  });
  
  if (granularity === "daily") {
    // Daily view - generate all 30 days with DD-MMM-YYYY format
    const rows = [];
    const offsetPerDay = numDays > 0 ? Math.round(MANUAL_EXECUTIONS_OFFSET / numDays) : 0;
    
    // Build a daily aggregation from weekly data
    // We need to distribute weekly data across days (approximate)
    const dailyAgg = {};
    weeklyKeys.forEach(function(k) {
      const weekDate = parseDate(k);
      if (!weekDate) return;
      if (startDate && weekDate < startDate) return;
      const w = weeklyExecutionMap[k] || { totalExecuted: 0, automatedExecuted: 0 };
      // Distribute weekly count across 7 days (approximate)
      const perDay = {
        totalExecuted: Math.round(w.totalExecuted / 7),
        automatedExecuted: Math.round(w.automatedExecuted / 7)
      };
      for (var d = 0; d < 7; d++) {
        const dayDate = new Date(weekDate.getTime() + d * 24 * 60 * 60 * 1000);
        const dk = Utilities.formatDate(dayDate, tz, "yyyy-MM-dd");
        if (!dailyAgg[dk]) {
          dailyAgg[dk] = { totalExecuted: 0, automatedExecuted: 0 };
        }
        dailyAgg[dk].totalExecuted += perDay.totalExecuted;
        dailyAgg[dk].automatedExecuted += perDay.automatedExecuted;
      }
    });
    
    // Generate all 30 days
    for (var d = 0; d < numDays; d++) {
      const date = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
      const dateKey = Utilities.formatDate(date, tz, "yyyy-MM-dd");
      const label = Utilities.formatDate(date, tz, "dd-MMM-yyyy");
      const dayData = dailyAgg[dateKey] || { totalExecuted: 0, automatedExecuted: 0 };
      rows.push([label, dayData.totalExecuted + offsetPerDay, dayData.automatedExecuted]);
    }
    return rows;
  } else {
    // Monthly view - generate all months in the range
    if (numMonths > 0) {
      const rows = [];
      const offsetPerMonth = numMonths > 0 ? Math.round(MANUAL_EXECUTIONS_OFFSET / numMonths) : 0;
      
      for (var m = numMonths - 1; m >= 0; m--) {
        const monthDate = new Date(now.getFullYear(), now.getMonth() - m, 1);
        const mk = Utilities.formatDate(monthDate, tz, "yyyy-MM");
        const label = Utilities.formatDate(monthDate, tz, "MMM-yyyy");
        const agg = monthlyAgg[mk] || { totalExecuted: 0, automatedExecuted: 0 };
        rows.push([label, agg.totalExecuted + offsetPerMonth, agg.automatedExecuted]);
      }
      return rows;
    } else {
      // allTime - just show months with data
      const monthKeys = Object.keys(monthlyAgg).sort();
      const offsetPerMonth = monthKeys.length > 0 ? Math.round(MANUAL_EXECUTIONS_OFFSET / monthKeys.length) : 0;
      
      return monthKeys.map(function(mk) {
        const parts = mk.split("-");
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const monthDate = new Date(year, month, 1);
        const label = Utilities.formatDate(monthDate, tz, "MMM-yyyy");
        const agg = monthlyAgg[mk];
        return [label, agg.totalExecuted + offsetPerMonth, agg.automatedExecuted];
      });
    }
  }
}

function getDailyAutomationSummary(dailyRows) {
  if (!dailyRows || dailyRows.length === 0) {
    return { totalCount: 0, avgPerDay: 0 };
  }
  let total = 0;
  for (let i = 0; i < dailyRows.length; i++) {
    total += Number(dailyRows[i][1] || 0);
  }
  return {
    totalCount: total,
    avgPerDay: dailyRows.length ? (total / dailyRows.length) : 0
  };
}

function weekKey(dateObj) {
  const d = new Date(dateObj.getTime());
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  const tz = Session.getScriptTimeZone();
  // Use Monday date as stable sortable key.
  return Utilities.formatDate(d, tz, "yyyy-MM-dd");
}

function dayKey(dateObj) {
  const tz = Session.getScriptTimeZone();
  return Utilities.formatDate(dateObj, tz, "yyyy-MM-dd");
}

function monthKey(dateObj) {
  const tz = Session.getScriptTimeZone();
  return Utilities.formatDate(dateObj, tz, "yyyy-MM");
}

function findHeaderRow(values, requiredCols) {
  const searchRows = Math.min(values.length, 15);
  for (let i = 0; i < searchRows; i++) {
    const rowLower = values[i].map(function(x) { return String(x || "").trim().toLowerCase(); });
    const ok = requiredCols.every(function(col) {
      return rowLower.indexOf(String(col).toLowerCase()) !== -1;
    });
    if (ok) {
      return i;
    }
  }
  return -1;
}

function findColumn(headers, name) {
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i] || "").trim().toLowerCase() === String(name).toLowerCase()) {
      return i;
    }
  }
  return -1;
}

function parseDate(v) {
  if (v === null || v === undefined || v === "") {
    return null;
  }
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime())) {
    return v;
  }
  // Google Sheets / Excel serial date (UTC-based; matches cell date values).
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  if (!s) {
    return null;
  }
  const dt = new Date(s.replace(" ", "T"));
  if (isNaN(dt.getTime())) {
    return null;
  }
  return dt;
}

function round2(n) {
  return Math.round((n || 0) * 100) / 100;
}

function formatNum(n, digits) {
  return Number(n || 0).toFixed(digits);
}

function median(arr) {
  if (!arr || arr.length === 0) return 0;
  const a = arr.slice().sort(function(x, y) { return x - y; });
  const mid = Math.floor(a.length / 2);
  if (a.length % 2 === 0) {
    return (a[mid - 1] + a[mid]) / 2;
  }
  return a[mid];
}

function formatMonthWeekLabel(dateObj) {
  const d = new Date(dateObj.getTime());
  const tz = Session.getScriptTimeZone();
  const monthYear = Utilities.formatDate(d, tz, "MMMM yyyy");

  const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7; // Monday-based
  const weekNum = Math.min(Math.floor((d.getDate() + mondayOffset - 1) / 7) + 1, 5);

  return monthYear + " Week " + weekNum;
}

function formatMonthWeekFromMonday(weekStartDate) {
  const d = new Date(weekStartDate.getTime());
  const year = d.getFullYear();
  const month = d.getMonth();
  const tz = Session.getScriptTimeZone();

  const firstOfMonth = new Date(year, month, 1);
  const firstDay = firstOfMonth.getDay(); // 0=Sun, 1=Mon, ...
  const daysToFirstMonday = firstDay === 1 ? 0 : (firstDay === 0 ? 1 : (8 - firstDay));
  const firstMonday = new Date(year, month, 1 + daysToFirstMonday);
  firstMonday.setHours(0, 0, 0, 0);

  const weekNum = Math.floor((d.getTime() - firstMonday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  // Format: "Mar'26 W4" for compact display
  const monthShort = Utilities.formatDate(d, tz, "MMM");
  const yearShort = Utilities.formatDate(d, tz, "yy");
  return monthShort + "'" + yearShort + " W" + weekNum;
}

function findColumnAlias(headers, names) {
  for (let n = 0; n < names.length; n++) {
    const idx = findColumn(headers, names[n]);
    if (idx !== -1) return idx;
  }
  return -1;
}

function resolveTicketPlatform(events) {
  if (!events || events.length === 0) return "Web";
  for (let i = 0; i < events.length; i++) {
    const raw = String(events[i].subDept || "").toLowerCase();
    if (!raw) continue;
    if (raw.indexOf("mobile") !== -1) return "Mobile";
    if (raw.indexOf("web") !== -1) return "Web";
  }
  // Business rule in this sheet: non-mobile defaults to Web.
  return "Web";
}

function isTicketInPlatform(ticketPlatform, selectedPlatform) {
  if (!selectedPlatform || selectedPlatform === "All") return true;
  if (selectedPlatform === "Mobile") return ticketPlatform === "Mobile";
  if (selectedPlatform === "Web") return ticketPlatform === "Web";
  return true;
}

function getSelectedPeriod(sheet) {
  const val = sheet.getRange("AA1").getValue();
  return val || "pastWeek";
}

function setSelectedPeriod(sheet, periodKey) {
  sheet.getRange("AA1").setValue(periodKey);
}

// Cache columns for each period's QC chart data (pre-calculated during refresh)
// AE-AF: pastWeek, AG-AH: past30Days, AI-AJ: pastQuarter, AK-AL: past6Months, AM-AN: pastYear, AO-AP: allTime
var PERIOD_CACHE_COLS = {
  pastWeek: { start: 31, label: "Past Week" },      // AE-AF
  past30Days: { start: 33, label: "Past 30 Days" }, // AG-AH
  pastQuarter: { start: 35, label: "Past Quarter" }, // AI-AJ
  past6Months: { start: 37, label: "Past 6 Months" }, // AK-AL
  pastYear: { start: 39, label: "Past Year" },      // AM-AN
  allTime: { start: 41, label: "All Time" }         // AO-AP
};

function cacheAllPeriodChartData(sheet, allPeriodStats) {
  const tz = Session.getScriptTimeZone();
  const periods = ["pastWeek", "past30Days", "pastQuarter", "past6Months", "pastYear", "allTime"];
  
  periods.forEach(function(periodKey) {
    const cacheCol = PERIOD_CACHE_COLS[periodKey].start;
    const pmStats = allPeriodStats[periodKey];
    var rows = [];
    
    // Different granularity based on period
    if (periodKey === "pastWeek") {
      // Past Week: Show ALL 7 days with day names (Mon 24-Mar, Tue 25-Mar, etc.)
      const daily = pmStats.daily || {};
      const now = new Date();
      
      // Generate all 7 days from 6 days ago to today
      for (var i = 6; i >= 0; i--) {
        const dt = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const key = Utilities.formatDate(dt, tz, "yyyy-MM-dd");
        const d = daily[key] || { qcSum: 0, qcCount: 0 };
        
        // Format: "Mon 24-Mar"
        const dayName = Utilities.formatDate(dt, tz, "EEE");
        const dateStr = Utilities.formatDate(dt, tz, "dd-MMM");
        const label = dayName + " " + dateStr;
        const avgQcDays = d.qcCount > 0 ? (d.qcSum / d.qcCount) : 0;
        rows.push([label, Math.round(avgQcDays * 10) / 10]);
      }
      
    } else if (periodKey === "past30Days") {
      // Past 30 Days: Show ALL 30 days with dd-MMM format
      const daily = pmStats.daily || {};
      const now = new Date();
      
      // Generate all 30 days
      for (var j = 29; j >= 0; j--) {
        const dt = new Date(now.getTime() - j * 24 * 60 * 60 * 1000);
        const key = Utilities.formatDate(dt, tz, "yyyy-MM-dd");
        const d = daily[key] || { qcSum: 0, qcCount: 0 };
        
        // Format: "01-Mar"
        const label = Utilities.formatDate(dt, tz, "dd-MMM");
        const avgQcDays = d.qcCount > 0 ? (d.qcSum / d.qcCount) : 0;
        rows.push([label, Math.round(avgQcDays * 10) / 10]);
      }
      
    } else if (periodKey === "pastQuarter") {
      // Past Quarter: Show monthly data with "MMM-YYYY" format (e.g., "Jan-2026")
      const monthly = pmStats.monthly || {};
      const monthlyKeys = Object.keys(monthly).sort();
      rows = monthlyKeys.map(function(k) {
        const m = monthly[k] || { qcSum: 0, qcCount: 0 };
        const dt = parseDate(k + "-01"); // Add day for parsing
        // Format: "Jan-2026"
        const label = dt ? Utilities.formatDate(dt, tz, "MMM-yyyy") : k;
        const avgQcDays = m.qcCount > 0 ? (m.qcSum / m.qcCount) : 0;
        return [label, Math.round(avgQcDays * 10) / 10];
      }).filter(function(row) { return row[1] > 0; });
      
    } else if (periodKey === "past6Months") {
      // Past 6 Months: Show monthly data with "MMM-YYYY" format (e.g., "Jan-2026")
      const monthly = pmStats.monthly || {};
      const monthlyKeys = Object.keys(monthly).sort();
      rows = monthlyKeys.map(function(k) {
        const m = monthly[k] || { qcSum: 0, qcCount: 0 };
        const dt = parseDate(k + "-01");
        // Format: "Jan-2026"
        const label = dt ? Utilities.formatDate(dt, tz, "MMM-yyyy") : k;
        const avgQcDays = m.qcCount > 0 ? (m.qcSum / m.qcCount) : 0;
        return [label, Math.round(avgQcDays * 10) / 10];
      }).filter(function(row) { return row[1] > 0; });
      
    } else if (periodKey === "pastYear") {
      // Past Year: Show 12 months with "MMM-YYYY" format (e.g., "Jan-2026")
      const monthly = pmStats.monthly || {};
      const monthlyKeys = Object.keys(monthly).sort();
      rows = monthlyKeys.map(function(k) {
        const m = monthly[k] || { qcSum: 0, qcCount: 0 };
        const dt = parseDate(k + "-01");
        // Format: "Jan-2026"
        const label = dt ? Utilities.formatDate(dt, tz, "MMM-yyyy") : k;
        const avgQcDays = m.qcCount > 0 ? (m.qcSum / m.qcCount) : 0;
        return [label, Math.round(avgQcDays * 10) / 10];
      }).filter(function(row) { return row[1] > 0; });
      
    } else {
      // All Time: Show monthly data with "MMM-YYYY" format (e.g., "Jan-2026")
      const monthly = pmStats.monthly || {};
      const monthlyKeys = Object.keys(monthly).sort();
      rows = monthlyKeys.map(function(k) {
        const m = monthly[k] || { qcSum: 0, qcCount: 0 };
        const dt = parseDate(k + "-01");
        // Format: "Jan-2026"
        const label = dt ? Utilities.formatDate(dt, tz, "MMM-yyyy") : k;
        const avgQcDays = m.qcCount > 0 ? (m.qcSum / m.qcCount) : 0;
        return [label, Math.round(avgQcDays * 10) / 10];
      }).filter(function(row) { return row[1] > 0; });
    }
    
    // Clear and write cache for this period
    sheet.getRange(2, cacheCol, 1, 2).setValues([["Period", "AvgQC"]]);
    sheet.getRange(3, cacheCol, 200, 2).clearContent();
    if (rows.length > 0) {
      // Set first column as text format to prevent auto-conversion of labels
      const dataRange = sheet.getRange(3, cacheCol, rows.length, 2);
      sheet.getRange(3, cacheCol, rows.length, 1).setNumberFormat("@"); // Text format for labels
      dataRange.setValues(rows);
    }
    // Store row count in row 1
    sheet.getRange(1, cacheCol).setValue(rows.length);
  });
}

// Checkbox positions for each period (first column of each card)
// Cards are 4 columns wide: B-E, F-I, J-M
var PERIOD_CHECKBOXES = {
  pastWeek: { row: 6, col: 2, numCols: 4 },      // B6
  past30Days: { row: 6, col: 6, numCols: 4 },    // F6
  pastQuarter: { row: 6, col: 10, numCols: 4 },  // J6
  past6Months: { row: 10, col: 2, numCols: 4 },  // B10
  pastYear: { row: 10, col: 6, numCols: 4 },     // F10
  allTime: { row: 10, col: 10, numCols: 4 }      // J10
};

function detectClickedPeriod(row, col) {
  // Checkboxes are at first column of each card:
  // Row 6: B6 (col 2) = pastWeek, F6 (col 6) = past30Days, J6 (col 10) = pastQuarter
  // Row 10: B10 (col 2) = past6Months, F10 (col 6) = pastYear, J10 (col 10) = allTime
  if (row === 6) {
    if (col === 2) return "pastWeek";
    if (col === 6) return "past30Days";
    if (col === 10) return "pastQuarter";
  }
  if (row === 10) {
    if (col === 2) return "past6Months";
    if (col === 6) return "pastYear";
    if (col === 10) return "allTime";
  }
  return null;
}

function updateCheckboxStates(sheet, selectedPeriod) {
  // Uncheck all checkboxes and update styling, then check only the selected one
  const periods = ["pastWeek", "past30Days", "pastQuarter", "past6Months", "pastYear", "allTime"];
  
  periods.forEach(function(periodKey) {
    const pos = PERIOD_CHECKBOXES[periodKey];
    const isSelected = (periodKey === selectedPeriod);
    const periodColor = PERIOD_COLORS[periodKey] || APP_CONFIG.COLORS.BLUE;
    const numCols = pos.numCols || 4;
    
    // Remove any extra checkboxes from title row, then set only the first one
    const titleRow = sheet.getRange(pos.row, pos.col, 1, numCols);
    titleRow.removeCheckboxes();
    titleRow.setBackground(periodColor);
    
    // Re-add checkbox only in first cell
    const checkboxCell = sheet.getRange(pos.row, pos.col, 1, 1);
    checkboxCell.insertCheckboxes().setValue(isSelected);
    
    // Update card border for selection indicator
    const borderColor = isSelected ? "#FFFFFF" : APP_CONFIG.COLORS.BORDER;
    const borderStyle = isSelected ? SpreadsheetApp.BorderStyle.SOLID_THICK : SpreadsheetApp.BorderStyle.SOLID;
    const cardRange = sheet.getRange(pos.row, pos.col, 3, numCols);
    cardRange.setBorder(true, true, true, true, false, false, borderColor, borderStyle);
    
    // Update data rows background (highlight if selected)
    const dataBg = isSelected ? "#1E293B" : APP_CONFIG.COLORS.CARD;
    sheet.getRange(pos.row + 1, pos.col, 2, numCols).setBackground(dataBg);
  });
}

function updateChartOnly(sheet, selectedPeriod) {
  // Get cached data for this period (pre-calculated during refresh - instant!)
  const cacheInfo = PERIOD_CACHE_COLS[selectedPeriod];
  const cacheCol = cacheInfo.start;
  const periodLabel = cacheInfo.label;
  
  // Dynamic chart title based on granularity
  var chartTitle = "Avg QC Cycle Time - " + periodLabel;
  if (selectedPeriod === "pastWeek" || selectedPeriod === "past30Days") {
    chartTitle = "Daily Avg QC Cycle Time - " + periodLabel;
  } else {
    // pastQuarter, past6Months, pastYear, allTime - all show monthly
    chartTitle = "Monthly Avg QC Cycle Time - " + periodLabel;
  }
  
  // Read row count from cache
  const rowCount = sheet.getRange(1, cacheCol).getValue() || 0;
  
  if (rowCount > 0) {
    // Copy cached data to the active chart data range (AB:AC)
    const cachedData = sheet.getRange(2, cacheCol, rowCount + 1, 2).getValues();
    sheet.getRange("AB2:AC300").clearContent();
    // Set first column as text format to preserve labels
    sheet.getRange(2, 28, cachedData.length, 1).setNumberFormat("@");
    sheet.getRange(2, 28, cachedData.length, 2).setValues(cachedData);
  } else {
    sheet.getRange("AB2:AC300").clearContent();
    sheet.getRange("AB2:AC2").setValues([["Period", "Avg QC Cycle (days)"]]);
  }
  
  // Remove existing QC chart and redraw it
  const charts = sheet.getCharts();
  charts.forEach(function(chart) {
    const title = chart.getOptions().get("title") || "";
    if (title.indexOf("Avg QC Cycle Time") !== -1) {
      sheet.removeChart(chart);
    }
  });
  
  // Draw the updated QC chart
  if (rowCount > 0) {
    const qcCycleEnd = 2 + rowCount;
    const qcCycleRange = sheet.getRange("AB2:AC" + qcCycleEnd);
    const chartWidth = 1430;
    const chartHeight = 250;
    
    const qcCycleChart = sheet.newChart()
      .asLineChart()
      .addRange(qcCycleRange)
      .setPosition(14, 2, 0, 0)
      .setOption("width", chartWidth)
      .setOption("height", chartHeight)
      .setOption("title", chartTitle)
      .setOption("backgroundColor", APP_CONFIG.COLORS.CARD)
      .setOption("legend", { position: "none" })
      .setOption("hAxis", { 
        textStyle: { color: APP_CONFIG.COLORS.TEXT, fontSize: 10 }, 
        slantedText: true, 
        slantedTextAngle: 45 
      })
      .setOption("vAxis", { 
        textStyle: { color: APP_CONFIG.COLORS.TEXT }, 
        minValue: 0,
        title: "Avg Days",
        titleTextStyle: { color: APP_CONFIG.COLORS.TEXT }
      })
      .setOption("titleTextStyle", { color: APP_CONFIG.COLORS.TEXT, fontSize: 14 })
      .setOption("curveType", "none")
      .setOption("pointSize", 6)
      .setOption("lineWidth", 2)
      .setOption("series", { 
        0: { 
          color: "#60A5FA",
          lineWidth: 2,
          pointSize: 6,
          pointShape: "circle",
          visibleInLegend: false
        } 
      })
      .setOption("trendlines", { 
        0: { 
          type: "linear", 
          color: "#FF6B6B", 
          lineWidth: 3, 
          opacity: 0.8, 
          showR2: false, 
          visibleInLegend: false 
        } 
      })
      .build();
    sheet.insertChart(qcCycleChart);
  }
}

function onEdit(e) {
  try {
    const sh = e.range.getSheet();
    const sheetName = sh.getName();
    
    // Handle Module Coverage sheet: Sub-Section dropdown (row 4, col B)
    if (sheetName === APP_CONFIG.MODULE_COVERAGE_SHEET) {
      const filterRowNum = parseInt(sh.getRange("Z1").getValue(), 10) || 0;
      if (filterRowNum && e.range.getRow() === filterRowNum && e.range.getColumn() === 2) {
        const subSection = String(sh.getRange(filterRowNum, 2).getValue() || "All");
        refreshModuleCoverageForSelection(sh, subSection);
      }
      return;
    }
    
    if (sheetName !== APP_CONFIG.DASHBOARD_SHEET) return;
    const row = e.range.getRow();
    const col = e.range.getColumn();
    
    // Detect checkbox click on time period cards (row 6 or 10, first column of each card)
    // Checkboxes are at: B6, F6, J6, B10, F10, J10
    const isCheckboxRow = (row === 6 || row === 10);
    const isCheckboxCol = (col === 2 || col === 6 || col === 10); // B, F, J columns
    
    if (isCheckboxRow && isCheckboxCol) {
      const clickedPeriod = detectClickedPeriod(row, col);
      if (clickedPeriod) {
        const currentPeriod = getSelectedPeriod(sh);
        
        // Only update if clicking a different period
        if (clickedPeriod !== currentPeriod) {
          // Store new selection
          setSelectedPeriod(sh, clickedPeriod);
          
          // Update checkbox states (uncheck others, check selected)
          updateCheckboxStates(sh, clickedPeriod);
          
          // Update only the chart - no full page refresh
          updateChartOnly(sh, clickedPeriod);
        } else {
          // If clicking the same period, ensure it stays checked
          sh.getRange(row, col).setValue(true);
        }
      }
      return;
    }
    
    // Detect dropdown change on Automation section period filter (row 28, col 12 - merged range)
    if (row === 28 && col === 12) {
      const selectedLabel = e.value || sh.getRange(row, col).getValue();
      const periodKey = getPeriodKeyFromLabel(selectedLabel);
      const currentPeriod = getSelectedAutomationPeriod(sh);
      
      if (periodKey !== currentPeriod) {
        setSelectedAutomationPeriod(sh, periodKey);
        // Fast update - only redraw the automation chart
        updateAutomationChartFast(sh, periodKey);
      }
      return;
    }
    
    // Detect dropdown change on Utilization section period filter (row 50, col 12 - merged range)
    if (row === 50 && col === 12) {
      const selectedLabel = e.value || sh.getRange(row, col).getValue();
      const periodKey = getPeriodKeyFromLabel(selectedLabel);
      const currentPeriod = getSelectedUtilizationPeriod(sh);
      
      if (periodKey !== currentPeriod) {
        setSelectedUtilizationPeriod(sh, periodKey);
        // Fast update - only redraw the utilization chart
        updateUtilizationChartFast(sh, periodKey);
      }
      return;
    }
  } catch (err) {
    Logger.log("onEdit error: " + err.message);
  }
}

// ===== MODULE COVERAGE SHEET (revised) =====
// Sub-Section filter uses only "Sub Section" on TestRail_Cases (not "Module").

/**
 * Column index for Sub Section (falls back to legacy "Section" header).
 */
function getSubSectionColumnIndex(headersLower) {
  let idx = headersLower.indexOf("sub section");
  if (idx < 0) idx = headersLower.indexOf("section");
  return idx;
}

/** Trim and collapse internal whitespace for reliable Sub Section matching */
function normalizeSubSectionName(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ");
}

function isAutomationCandidateYes(val) {
  return String(val || "")
    .trim()
    .toLowerCase() === "yes";
}

/**
 * Split Ticket ID cell (may list multiple IDs from plan + run names, comma/semicolon separated).
 */
function parseTicketIdsFromCell(val) {
  if (val === null || val === undefined) return [];
  const s = String(val).trim();
  if (!s) return [];
  return s
    .split(/[,;]\s*/)
    .map(function (x) {
      return x.trim();
    })
    .filter(Boolean);
}

/**
 * Execution aggregates per case from TestRail_Execution
 * Returns: {caseId: {execCount, ticketIds: Set, ticketCount, ticketIdsList}}
 */
function getCaseExecutionDetails() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const execSheet = ss.getSheetByName(APP_CONFIG.TESTRAIL_EXEC_SHEET);
  if (!execSheet) {
    return {};
  }
  const data = execSheet.getDataRange().getValues();
  if (data.length < 2) {
    return {};
  }
  const headers = data[0].map(h => String(h).trim().toLowerCase());
  const colIdx = {
    caseId: headers.indexOf("case id"),
    ticketId: headers.indexOf("ticket id"),
  };
  const caseDetails = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const caseId = colIdx.caseId >= 0 ? row[colIdx.caseId] : "";
    if (!caseId) continue;
    const ticketCell = colIdx.ticketId >= 0 ? row[colIdx.ticketId] : "";
    if (!caseDetails[caseId]) {
      caseDetails[caseId] = { execCount: 0, ticketIds: new Set() };
    }
    caseDetails[caseId].execCount++;
    const ticketParts = parseTicketIdsFromCell(ticketCell);
    for (let t = 0; t < ticketParts.length; t++) {
      caseDetails[caseId].ticketIds.add(ticketParts[t]);
    }
  }
  for (const cid in caseDetails) {
    const d = caseDetails[cid];
    d.ticketCount = d.ticketIds.size;
    d.ticketIdsList = Array.from(d.ticketIds).sort().join(", ");
  }
  return caseDetails;
}

/**
 * All cases from TestRail_Cases with sub-section + execution metrics (for Module_Coverage).
 */
function getModuleCoverageCaseRows(execDetails) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const casesSheet = ss.getSheetByName(APP_CONFIG.TESTRAIL_SHEET);
  if (!casesSheet) {
    return [];
  }
  const data = casesSheet.getDataRange().getValues();
  if (data.length < 2) {
    return [];
  }
  const headers = data[0].map(h => String(h).trim().toLowerCase());
  const subSecIdx = getSubSectionColumnIndex(headers);
  const colIdx = {
    caseId: headers.indexOf("case id"),
    title: headers.indexOf("title"),
    automationStatus: headers.indexOf("automation status"),
    automationCandidate: headers.indexOf("automation candidate"),
    executionMethod: headers.indexOf("execution method"),
  };
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const caseId = colIdx.caseId >= 0 ? row[colIdx.caseId] : "";
    if (!caseId) continue;
    const execInfo = execDetails[caseId] || {
      execCount: 0,
      ticketCount: 0,
      ticketIdsList: "",
    };
    const subLabel =
      subSecIdx >= 0 ? normalizeSubSectionName(row[subSecIdx]) : "";
    rows.push({
      caseId: caseId,
      title: colIdx.title >= 0 ? String(row[colIdx.title] || "") : "",
      section: subLabel,
      automationStatus: colIdx.automationStatus >= 0 ? String(row[colIdx.automationStatus] || "") : "",
      automationCandidate: colIdx.automationCandidate >= 0 ? String(row[colIdx.automationCandidate] || "").trim() : "",
      executionMethod: colIdx.executionMethod >= 0 ? String(row[colIdx.executionMethod] || "") : "",
      execCount: execInfo.execCount,
      ticketCount: execInfo.ticketCount,
      ticketIds: execInfo.ticketIdsList || "",
    });
  }
  return rows;
}

/**
 * Unique Sub-Section values from the Sub Section column, sorted.
 */
function getUniqueSubSections(caseRows) {
  const s = new Set();
  caseRows.forEach(function (c) {
    if (c.section) {
      s.add(normalizeSubSectionName(c.section));
    }
  });
  return Array.from(s).sort(function (a, b) {
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

function filterCasesBySubSection(caseRows, subSection) {
  if (!subSection || subSection === "All") {
    return caseRows;
  }
  const want = normalizeSubSectionName(subSection).toLowerCase();
  return caseRows.filter(function (c) {
    const got = normalizeSubSectionName(c.section).toLowerCase();
    return got === want;
  });
}

function computeSubSectionMetrics(caseRows) {
  const total = caseRows.length;
  let candidates = 0;
  let automated = 0;
  for (let i = 0; i < caseRows.length; i++) {
    if (isAutomationCandidateYes(caseRows[i].automationCandidate)) candidates++;
    if (isCaseAutomated(caseRows[i].automationStatus, caseRows[i].executionMethod)) automated++;
  }
  const pct = total > 0 ? Math.round((automated / total) * 1000) / 10 : 0;
  return { total: total, candidates: candidates, automated: automated, pct: pct };
}

/** Table list: automated cases only (Module_Coverage detail grid). */
function filterModuleCoverageAutomatedOnly(caseRows) {
  return caseRows.filter(function (c) {
    return isCaseAutomated(c.automationStatus, c.executionMethod);
  });
}

/**
 * Update summary tiles (row 5 labels, row 6 values) — B..E
 */
function updateModuleCoverageTiles(sheet, metrics) {
  const COLORS = APP_CONFIG.COLORS;
  sheet
    .getRange(6, 2, 1, 4)
    .setValues([
      [metrics.total, metrics.candidates, metrics.automated, metrics.pct + "%"],
    ])
    .setBackground(COLORS.CARD)
    .setFontColor(COLORS.TEXT)
    .setFontSize(16)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
}

/**
 * Write case table from first data row (Z3) to last row; 6 columns.
 */
function updateModuleCoverageCaseList(sheet, caseRows) {
  const COLORS = APP_CONFIG.COLORS;
  const dataStartRow = parseInt(sheet.getRange("Z3").getValue(), 10) || 10;
  const lastRow = sheet.getLastRow();
  const numCols = 6;
  if (lastRow >= dataStartRow) {
    sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, numCols).clearContent();
    sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, numCols).setBackground(COLORS.BG);
  }
  if (!caseRows.length) {
    sheet
      .getRange(dataStartRow, 1, 1, numCols)
      .merge()
      .setValue("No automated cases for this Sub-Section selection.")
      .setBackground(COLORS.CARD)
      .setFontColor(COLORS.MUTED);
    return;
  }
  const caseData = caseRows.map(function (c) {
    const t = c.title.length > 80 ? c.title.substring(0, 77) + "..." : c.title;
    const ids = c.ticketIds.length > 120 ? c.ticketIds.substring(0, 117) + "..." : c.ticketIds;
    return [c.caseId, t, c.automationStatus, c.execCount, c.ticketCount, ids];
  });
  sheet.getRange(dataStartRow, 1, caseData.length, numCols).setValues(caseData);
  sheet.getRange(dataStartRow, 1, caseData.length, numCols).setBackground(COLORS.CARD).setFontColor(COLORS.TEXT).setFontSize(10);
  for (let i = 0; i < caseData.length; i++) {
    if (i % 2 === 1) {
      sheet.getRange(dataStartRow + i, 1, 1, numCols).setBackground(COLORS.BG);
    }
  }
}

/**
 * Recompute tiles + case list for selected Sub-Section ("All" or name).
 */
function refreshModuleCoverageForSelection(sheet, subSection) {
  const execDetails = getCaseExecutionDetails();
  const allRows = getModuleCoverageCaseRows(execDetails);
  const filtered = filterCasesBySubSection(allRows, subSection);
  const metrics = computeSubSectionMetrics(filtered);
  updateModuleCoverageTiles(sheet, metrics);
  updateModuleCoverageCaseList(sheet, filterModuleCoverageAutomatedOnly(filtered));
  SpreadsheetApp.flush();
}

/**
 * Create or refresh Module_Coverage: layout, dropdown, tiles, empty table then fill "All".
 */
function refreshModuleCoverageSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(APP_CONFIG.MODULE_COVERAGE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(APP_CONFIG.MODULE_COVERAGE_SHEET);
  } else {
    sheet.clear();
  }
  const COLORS = APP_CONFIG.COLORS;
  const execDetails = getCaseExecutionDetails();
  const allRows = getModuleCoverageCaseRows(execDetails);
  const subList = getUniqueSubSections(allRows);
  const dropdownValues = ["All"].concat(subList);

  sheet.getRange(1, 1, 1, 6)
    .merge()
    .setValue("Module Coverage Report")
    .setBackground(COLORS.BG)
    .setFontColor(COLORS.CYAN)
    .setFontSize(18)
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  sheet.getRange(2, 1, 1, 6)
    .merge()
    .setValue("Last Updated: " + timestamp)
    .setBackground(COLORS.BG)
    .setFontColor(COLORS.MUTED)
    .setFontSize(10)
    .setHorizontalAlignment("center");

  sheet.getRange(4, 1).setValue("Sub-Section:").setBackground(COLORS.BG).setFontColor(COLORS.MUTED).setFontWeight("bold");
  const ddCell = sheet.getRange(4, 2, 1, 4).merge();
  ddCell.setValue("All").setBackground(COLORS.CARD).setFontColor(COLORS.TEXT).setHorizontalAlignment("left");
  if (dropdownValues.length > 1) {
    ddCell.setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(dropdownValues, true).setAllowInvalid(false).build()
    );
  }

  sheet.getRange(5, 2, 1, 4).setValues([["Total TCs", "Automation Candidates", "Total Automated", "Automation %"]]);
  sheet.getRange(5, 2, 1, 4).setBackground(COLORS.VIOLET).setFontColor(COLORS.TEXT).setFontWeight("bold").setHorizontalAlignment("center");
  sheet.getRange(6, 2, 1, 4).setValues([[0, 0, 0, "0%"]]);
  sheet.getRange(6, 2, 1, 4).setBackground(COLORS.CARD).setFontColor(COLORS.TEXT).setFontSize(16).setFontWeight("bold").setHorizontalAlignment("center");

  sheet.getRange(8, 1, 1, 6)
    .merge()
    .setValue("Automated test cases (ticket IDs from test plan / run names)")
    .setBackground(COLORS.CARD)
    .setFontColor(COLORS.TEXT)
    .setFontSize(12)
    .setFontWeight("bold");
  const caseHeaders = [
    "Case ID",
    "Title",
    "Automation Status",
    "Exec Count",
    "Unique Tickets",
    "Ticket IDs",
  ];
  sheet.getRange(9, 1, 1, 6).setValues([caseHeaders]);
  sheet.getRange(9, 1, 1, 6).setBackground(COLORS.BLUE).setFontColor(COLORS.TEXT).setFontWeight("bold").setHorizontalAlignment("center");

  sheet.getRange("Z1").setValue(4);
  sheet.getRange("Z2").setValue(9);
  sheet.getRange("Z3").setValue(10);
  sheet.setFrozenRows(9);
  sheet.setColumnWidth(1, 90);
  sheet.setColumnWidth(2, 320);
  sheet.setColumnWidth(3, 130);
  sheet.setColumnWidth(4, 90);
  sheet.setColumnWidth(5, 110);
  sheet.setColumnWidth(6, 220);

  refreshModuleCoverageForSelection(sheet, "All");
  Logger.log("Module Coverage sheet refreshed (revised layout).");
}

// ============================================================
// QC Pipeline tabs (QC_With_QA / QC_With_Dev)
// Click a count cell in "SUMMARY BY MODULE" -> the "TICKET DETAILS"
// table filters down to only those tickets.
// Click the module name, the TOTAL row, or the summary header to
// clear the filter (show all tickets).
// ============================================================

const QC_PIPELINE_TABS = ["QC_With_QA", "QC_With_Dev"];

function onSelectionChange(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    if (QC_PIPELINE_TABS.indexOf(sheet.getName()) === -1) return;
    handleQcPipelineSelection_(sheet, e.range);
  } catch (err) {
    // Never throw from a simple trigger
    Logger.log("onSelectionChange error: " + err);
  }
}

function qcPipelineClearFilter() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (QC_PIPELINE_TABS.indexOf(sheet.getName()) === -1) {
    SpreadsheetApp.getUi().alert(
      "Switch to QC_With_QA or QC_With_Dev first, then run this menu item."
    );
    return;
  }
  const layout = findQcPipelineLayout_(sheet);
  if (!layout) return;
  applyQcPipelineFilter_(sheet, layout, null, null);
}

function handleQcPipelineSelection_(sheet, range) {
  const layout = findQcPipelineLayout_(sheet);
  if (!layout) return;

  const row = range.getRow();
  const col = range.getColumn();

  // Click anywhere in summary HEADER row -> clear filter
  if (row === layout.summaryHeaderRow) {
    applyQcPipelineFilter_(sheet, layout, null, null);
    return;
  }

  // Click anywhere in TOTAL row -> clear filter (= all tickets)
  if (row === layout.summaryTotalRow) {
    applyQcPipelineFilter_(sheet, layout, null, null);
    return;
  }

  // Inside the summary data block?
  if (row < layout.summaryDataStart || row > layout.summaryDataEnd) return;

  // Module name in column A
  const module = String(sheet.getRange(row, 1).getValue() || "").trim();
  if (!module) return;

  if (col === 1) {
    // Clicked the module name itself -> filter by module only
    applyQcPipelineFilter_(sheet, layout, module, null);
    return;
  }
  if (col === 2) {
    // Clicked the Total column -> filter by module only
    applyQcPipelineFilter_(sheet, layout, module, null);
    return;
  }
  if (col >= 3 && col <= layout.summaryColCount) {
    // Clicked a status count -> filter by module + status
    const statusName = String(
      sheet.getRange(layout.summaryHeaderRow, col).getValue() || ""
    ).trim();
    if (!statusName) return;
    // Skip if the cell is empty / zero (nothing to show)
    const cellValue = sheet.getRange(row, col).getValue();
    if (cellValue === "" || cellValue === 0) {
      applyQcPipelineFilter_(sheet, layout, module, null);
      return;
    }
    applyQcPipelineFilter_(sheet, layout, module, statusName);
    return;
  }
}

function findQcPipelineLayout_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 5 || lastCol < 2) return null;

  const colA = sheet.getRange(1, 1, lastRow, 1).getValues();

  let summarySectionRow = -1;
  let detailsSectionRow = -1;
  let summaryTotalRow = -1;

  for (let i = 0; i < colA.length; i++) {
    const v = String(colA[i][0] || "").trim();
    if (v === "SUMMARY BY MODULE") summarySectionRow = i + 1;
    else if (v === "TICKET DETAILS") detailsSectionRow = i + 1;
    else if (v === "TOTAL" && summaryTotalRow === -1) summaryTotalRow = i + 1;
  }
  if (summarySectionRow < 0 || detailsSectionRow < 0) return null;

  const summaryHeaderRow = summarySectionRow + 1;
  const detailsHeaderRow = detailsSectionRow + 1;
  if (summaryTotalRow < 0) summaryTotalRow = detailsSectionRow - 2;

  // Summary col count = number of non-empty headers
  const sumHeaders = sheet.getRange(summaryHeaderRow, 1, 1, lastCol).getValues()[0];
  let summaryColCount = 0;
  for (let i = 0; i < sumHeaders.length; i++) {
    if (sumHeaders[i] !== "" && sumHeaders[i] !== null) summaryColCount = i + 1;
    else if (summaryColCount > 0) break;
  }

  // Details col count
  const detHeaders = sheet.getRange(detailsHeaderRow, 1, 1, lastCol).getValues()[0];
  let detailsColCount = 0;
  for (let i = 0; i < detHeaders.length; i++) {
    if (detHeaders[i] !== "" && detHeaders[i] !== null) detailsColCount = i + 1;
    else if (detailsColCount > 0) break;
  }

  return {
    summarySectionRow: summarySectionRow,
    summaryHeaderRow: summaryHeaderRow,
    summaryDataStart: summaryHeaderRow + 1,
    summaryDataEnd: summaryTotalRow - 1,
    summaryTotalRow: summaryTotalRow,
    summaryColCount: summaryColCount,
    detailsSectionRow: detailsSectionRow,
    detailsHeaderRow: detailsHeaderRow,
    detailsDataEnd: lastRow,
    detailsColCount: detailsColCount,
    detailsHeaders: detHeaders.slice(0, detailsColCount),
  };
}

function applyQcPipelineFilter_(sheet, layout, module, status) {
  const existing = sheet.getFilter();
  if (existing) existing.remove();

  // Don't try to filter when the details range is empty
  if (layout.detailsDataEnd < layout.detailsHeaderRow) return;

  const range = sheet.getRange(
    layout.detailsHeaderRow,
    1,
    layout.detailsDataEnd - layout.detailsHeaderRow + 1,
    layout.detailsColCount
  );
  const filter = range.createFilter();

  if (!module && !status) return; // no criteria = "show all"

  // Find Module / Status columns inside the details header
  const headers = layout.detailsHeaders.map(function (h) {
    return String(h || "").trim();
  });
  const moduleColIdx = headers.indexOf("Module") + 1;
  const statusColIdx = headers.indexOf("Status") + 1;

  if (module && moduleColIdx > 0) {
    filter.setColumnFilterCriteria(
      moduleColIdx,
      SpreadsheetApp.newFilterCriteria().whenTextEqualTo(module).build()
    );
  }
  if (status && statusColIdx > 0) {
    filter.setColumnFilterCriteria(
      statusColIdx,
      SpreadsheetApp.newFilterCriteria().whenTextEqualTo(status).build()
    );
  }
}
