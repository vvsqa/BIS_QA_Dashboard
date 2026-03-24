# QA Cycle Time Dashboard - Summary for Client

## Overview

We have built a comprehensive QA Cycle Time Dashboard within the Aura 360 application to track and monitor QA performance metrics. This dashboard uses the PM Tracker's status change API to calculate QA cycle times and identify areas for improvement.

---

## What We Have Built

### 1. Executive Dashboard

**Key Performance Indicators (KPIs):**
| Metric | Description |
|--------|-------------|
| Total Tickets | Count of all tickets with QA activity |
| QA Completed | Tickets that have completed the QA cycle |
| Avg QA Days | Average time tickets spend in QA (business days) |
| Median Days | Median QA cycle time (less affected by outliers) |
| First Pass Rate | Percentage of tickets passing QA on first attempt |
| Avg Cycles | Average number of times tickets go through QA |
| Total QA Fails | Count of QA review failures |
| In QA Now | Tickets currently in QA-related statuses |
| Total Hold Hours | Time spent in hold statuses (excluded from cycle time) |

**Visualizations:**
- Monthly QA cycle time trend (line chart)
- Status distribution (pie chart)
- QA time breakdown by Platform
- QA time breakdown by Priority
- QA time breakdown by QC Tester
- QA time breakdown by Developer
- Cycle time reduction targets (10%, 20%, 30%, 50%)

### 2. Historical Impact Analysis

- Shows how rework (multiple QA cycles) affects overall timelines
- Compares 1-cycle vs 2-cycle vs 3+ cycle tickets
- Calculates extra days lost to rework
- Identifies high-impact areas for improvement

### 3. Ticket Data View

- Searchable, paginated table of all tickets
- Columns: Ticket ID, Status, Priority, Platform, QC Tester, Backend Dev, Frontend Dev, QA Start/End, Hold Hours, QA Days, Cycles, Fails
- Filterable by date range, number of cycles, and platform

### 4. Methodology Documentation

- Complete documentation of all calculations
- Status definitions used for tracking
- Alignment with client goals

### 5. Excel Export

- Full dashboard export with embedded formulas
- Same date filtering as web dashboard
- Can be shared offline for analysis

---

## How Cycle Time Is Calculated

```
QA Cycle Time = (QA End Date - QA Start Date) - Hold Time
Business Days = Cycle Time / 8 hours
```

- **QA Start**: When ticket enters "QC Testing" status
- **QA End**: When ticket moves to "BIS Testing", "Closed", "Approved for Live", or "Moved to Live"
- **Hold Time**: Time spent in hold statuses (excluded from cycle time)
- **QA Cycle**: Each time a ticket re-enters QA status counts as a new cycle

---

## Current Status Definitions

We are currently tracking these statuses:

| Category | Statuses Used |
|----------|---------------|
| **QA Start** | QC Testing |
| **QA End** | BIS Testing, Closed, Approved for Live, Moved to Live |
| **QA Hold** | QC Testing On-hold |
| **QA Fail** | QC Review Fail |

---

## Additional Statuses Found in PM Data

From analyzing the PM status change data, we found these additional QA-related statuses that exist but are **not currently being tracked**:

| Status | Current Treatment | Potential Impact |
|--------|-------------------|------------------|
| **QC Testing in Progress** | Not tracked | May be missing active QA time |
| **QC Testing Hold** | Not tracked | May be missing hold time deductions |
| **Tested - Awaiting Fixes** | Not tracked | May be missing fail counts |
| **Testing In Progress** | Not tracked | Unclear if QA or Dev testing |

---

## Recommended PM Workflow Changes

### Option A: Standardize Statuses (Recommended)

Consolidate QA-related statuses to a consistent, simplified set:

| Status | Purpose | Dashboard Treatment |
|--------|---------|---------------------|
| **QC Testing** | Ticket is being tested by QA | Start QA timer |
| **QC Testing On-hold** | Blocked/waiting for info | Pause QA timer |
| **QC Review Fail** | Failed QA, sent back to dev | Count as fail, increment cycle |
| **BIS Testing** | QA passed, ready for client | End QA timer |

**Actions Required:**
1. Deprecate `QC Testing in Progress` → Merge into `QC Testing`
2. Deprecate `QC Testing Hold` → Merge into `QC Testing On-hold`
3. Deprecate `Tested - Awaiting Fixes` → Merge into `QC Review Fail`
4. Clarify `Testing In Progress` → Is this QA or Dev testing?

**Benefits:**
- Cleaner workflow with fewer statuses
- More accurate tracking
- Easier for team to follow

### Option B: Track All Existing Statuses (No PM Changes)

We can update the dashboard to recognize all existing statuses without changing PM:

| Category | Statuses to Track |
|----------|-------------------|
| **QA Active** | QC Testing, QC Testing in Progress, Testing In Progress |
| **QA Hold** | QC Testing On-hold, QC Testing Hold, Hold/Pending |
| **QA Fail** | QC Review Fail, Tested - Awaiting Fixes |
| **QA End** | BIS Testing, Closed, Approved for Live, Moved to Live |

**Benefits:**
- No changes required in PM tool
- Immediate implementation
- All existing data captured

**Drawbacks:**
- Multiple statuses with similar purposes
- Potential for inconsistent usage by team

---

## Questions for Your Decision

1. **QC Testing in Progress**: Should this be treated as active QA time, or should we consolidate it into "QC Testing"?

2. **Testing In Progress**: Is this used for QA testing or developer testing? Should it be tracked as QA time?

3. **Tested - Awaiting Fixes**: Should this count as a QA failure, or is it different from "QC Review Fail"?

4. **Hold Statuses**: Are "QC Testing Hold" and "QC Testing On-hold" interchangeable, or do they have different meanings?

5. **Preferred Approach**: Would you prefer Option A (standardize statuses in PM) or Option B (track all existing statuses)?

---

## Future Enhancement: Direct Timestamps

For even more accurate tracking, we could add timestamp fields directly to tickets:

| Field | Purpose |
|-------|---------|
| QA Start Timestamp | When ticket first enters QA |
| QA End Timestamp | When ticket exits QA successfully |
| Time in QA | Calculated field |

This would eliminate reliance on parsing status change history and provide more precise measurements.

---

## Next Steps

1. **Confirm Status Definitions**: Let us know which option you prefer (A or B)
2. **Clarify Unknown Statuses**: Specifically `Testing In Progress` and `Tested - Awaiting Fixes`
3. **Schedule Discussion**: We're available to discuss any questions with you and Preeti

---

## Access

The QA Cycle Time Dashboard is available in the Aura 360 application under the "QA Cycle Dashboard" menu item. Access is available to Admin, Manager, Lead, and Client roles.

---

*Document prepared by: Vishnu V S*
*Date: March 16, 2026*
