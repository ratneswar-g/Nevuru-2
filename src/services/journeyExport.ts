import { Journey } from '../domain/types/index.ts';

export interface ExportJourneyOptions {
  filterName?: string;
  searchQuery?: string;
  userName?: string;
  userRole?: string;
}

/**
 * Format date time to a clear human-readable string
 */
export const formatExportDate = (dateStr?: string): string => {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
};

/**
 * Converts journey state into a friendly readable label
 */
export const formatJourneyState = (state: string): string => {
  return state
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

/**
 * Escape CSV field to prevent formula injection and handle quotes/commas
 */
const escapeCsvCell = (val: unknown): string => {
  if (val === null || val === undefined) return '""';
  let str = String(val).trim();
  // Protect against CSV injection (=, +, -, @)
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  // Escape inner double quotes
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
};

/**
 * Generates and downloads a CSV file for the given journey list
 */
export const exportJourneysToCsv = (
  journeys: Journey[],
  options: ExportJourneyOptions = {}
): void => {
  if (!journeys || journeys.length === 0) {
    throw new Error('No journeys available to export.');
  }

  const headers = [
    'Journey ID',
    'Date / Scheduled Time',
    'Status',
    'Booking Type',
    'Round Trip',
    'Hospital / Destination',
    'Destination Address',
    'Pickup Address',
    'Return Drop-off Address',
    'Care Partner Assigned',
    'Total Fare',
    'Currency',
    'Special Assistance Notes',
    'Created At',
  ];

  const rows = journeys.map((j) => {
    const scheduledOrCreated = j.scheduledPickupTime || j.createdAt;
    const fare = j.fareEstimate?.total ?? j.initialFareEstimate?.total ?? '';
    const currency = j.fareEstimate?.currency ?? j.initialFareEstimate?.currency ?? 'INR';
    const hospitalName = j.hospitalDestination?.name || 'Medical Facility';
    const hospitalAddress = j.hospitalDestination?.address || '';
    const pickupAddress = j.pickupLocation?.address || '';
    const returnAddress = j.returnDropoffLocation?.address || pickupAddress;
    const partner = j.carePartnerId || 'Unassigned';

    return [
      escapeCsvCell(j.id),
      escapeCsvCell(formatExportDate(scheduledOrCreated)),
      escapeCsvCell(formatJourneyState(j.currentState)),
      escapeCsvCell(j.bookingType),
      escapeCsvCell(j.isRoundTrip ? 'Yes' : 'No'),
      escapeCsvCell(hospitalName),
      escapeCsvCell(hospitalAddress),
      escapeCsvCell(pickupAddress),
      escapeCsvCell(returnAddress),
      escapeCsvCell(partner),
      escapeCsvCell(typeof fare === 'number' ? fare.toFixed(2) : fare),
      escapeCsvCell(currency),
      escapeCsvCell(j.specialAssistanceNotes || 'None'),
      escapeCsvCell(formatExportDate(j.createdAt)),
    ].join(',');
  });

  const filterNote = options.filterName ? `# Filter: ${options.filterName}\n` : '';
  const searchNote = options.searchQuery ? `# Search query: "${options.searchQuery}"\n` : '';
  const generatedNote = `# Generated: ${new Date().toISOString()} | Neravu Medical Companion\n`;
  const csvContent = '\uFEFF' + filterNote + searchNote + generatedNote + [headers.join(','), ...rows].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const timestamp = new Date().toISOString().slice(0, 10);
  const filterSlug = options.filterName ? `-${options.filterName.toLowerCase().replace(/\s+/g, '_')}` : '';
  link.setAttribute('href', url);
  link.setAttribute('download', `neravu-journeys${filterSlug}-${timestamp}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/**
 * Generates an accessible, beautifully styled, print-to-PDF document for the filtered journeys.
 * Uses window.print() in a dedicated iframe or printable window to preserve vectors, styling, and high fidelity.
 */
export const exportJourneysToPdf = (
  journeys: Journey[],
  options: ExportJourneyOptions = {}
): void => {
  if (!journeys || journeys.length === 0) {
    throw new Error('No journeys available to export.');
  }

  const timestamp = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const filterTitle = options.filterName ? options.filterName : 'All Journeys';
  const totalFare = journeys.reduce((sum, j) => {
    const amount = j.fareEstimate?.total ?? j.initialFareEstimate?.total ?? 0;
    return sum + (typeof amount === 'number' ? amount : 0);
  }, 0);

  const completedCount = journeys.filter((j) => j.currentState === 'COMPLETED').length;
  const upcomingCount = journeys.filter((j) =>
    j.bookingType === 'SCHEDULED' &&
    (j.currentState === 'DRAFT' || j.currentState === 'REQUESTED' || j.currentState === 'MATCHING')
  ).length;
  const cancelledCount = journeys.filter(
    (j) => j.currentState === 'CANCELLED' || j.currentState === 'PARTNER_CANCELLED'
  ).length;

  const tableRowsHtml = journeys
    .map((j, idx) => {
      const scheduledOrCreated = j.scheduledPickupTime || j.createdAt;
      const fare = j.fareEstimate?.total ?? j.initialFareEstimate?.total ?? null;
      const currency = j.fareEstimate?.currency ?? '₹';
      const hospitalName = j.hospitalDestination?.name || 'Medical Center';
      const hospitalAddr = j.hospitalDestination?.address || '';
      const pickupAddr = j.pickupLocation?.address || '';
      const state = formatJourneyState(j.currentState);

      let badgeBg = '#f1f5f9';
      let badgeColor = '#475569';
      let badgeBorder = '#cbd5e1';

      if (j.currentState === 'COMPLETED') {
        badgeBg = '#ecfdf5';
        badgeColor = '#047857';
        badgeBorder = '#a7f3d0';
      } else if (
        j.currentState === 'CANCELLED' ||
        j.currentState === 'PARTNER_CANCELLED'
      ) {
        badgeBg = '#fef2f2';
        badgeColor = '#b91c1c';
        badgeBorder = '#fecaca';
      } else if (
        j.currentState === 'REQUESTED' ||
        j.currentState === 'MATCHING' ||
        j.bookingType === 'SCHEDULED'
      ) {
        badgeBg = '#eff6ff';
        badgeColor = '#1d4ed8';
        badgeBorder = '#bfdbfe';
      } else {
        badgeBg = '#fffbeb';
        badgeColor = '#b45309';
        badgeBorder = '#fde68a';
      }

      return `
        <tr style="border-bottom: 1px solid #e2e8f0; ${idx % 2 === 1 ? 'background-color: #f8fafc;' : ''}">
          <td style="padding: 10px 12px; font-size: 11px; font-family: monospace; color: #475569; white-space: nowrap;">
            #${j.id.slice(0, 8)}
          </td>
          <td style="padding: 10px 12px; font-size: 12px; color: #1e293b; white-space: nowrap;">
            <strong>${formatExportDate(scheduledOrCreated)}</strong>
            <div style="font-size: 10px; color: #64748b; margin-top: 2px;">${j.bookingType} ${j.isRoundTrip ? '• Round Trip' : '• One-Way'}</div>
          </td>
          <td style="padding: 10px 12px; font-size: 12px; color: #0f172a;">
            <div style="font-weight: 600; color: #0f172a;">${escapeHtml(hospitalName)}</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">To: ${escapeHtml(hospitalAddr || 'Destination on file')}</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">From: ${escapeHtml(pickupAddr || 'Pickup location')}</div>
          </td>
          <td style="padding: 10px 12px; text-align: center;">
            <span style="display: inline-block; padding: 4px 8px; border-radius: 9999px; font-size: 10px; font-weight: 700; background-color: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; text-transform: uppercase; letter-spacing: 0.5px;">
              ${state}
            </span>
          </td>
          <td style="padding: 10px 12px; font-size: 12px; font-weight: 600; text-align: right; color: #0f172a; white-space: nowrap;">
            ${fare !== null ? `${currency} ${Number(fare).toFixed(2)}` : 'Included'}
          </td>
        </tr>
      `;
    })
    .join('');

  const printableHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Neravu Medical Journeys Report - ${escapeHtml(filterTitle)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 1.5cm;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 24px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0d9488;
      padding-bottom: 16px;
      margin-bottom: 20px;
    }
    .logo-title {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-name {
      font-size: 22px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.5px;
    }
    .brand-sub {
      font-size: 12px;
      color: #0d9488;
      font-weight: 600;
      margin-top: 2px;
    }
    .report-meta {
      text-align: right;
      font-size: 11px;
      color: #64748b;
    }
    .report-badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 8px;
      background: #f0fdfa;
      border: 1px solid #ccfbf1;
      color: #0f766e;
      font-weight: 700;
      font-size: 11px;
      margin-top: 4px;
    }
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }
    .card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 14px;
    }
    .card-label {
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 700;
      color: #64748b;
      letter-spacing: 0.5px;
    }
    .card-value {
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
      margin-top: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    th {
      background: #f1f5f9;
      color: #475569;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 10px 12px;
      border-top: 1px solid #cbd5e1;
      border-bottom: 2px solid #cbd5e1;
    }
    .footer {
      margin-top: 32px;
      border-top: 1px solid #e2e8f0;
      padding-top: 12px;
      font-size: 10px;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    @media print {
      body {
        padding: 0;
      }
      .no-print {
        display: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom: 16px; padding: 12px; background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
    <span style="font-size: 13px; color: #115e59; font-weight: 600;">
      Print Preview Ready: Press the Print button to save as PDF or print to paper.
    </span>
    <div>
      <button onclick="window.print()" style="background: #0d9488; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 700; font-size: 12px; cursor: pointer; margin-right: 8px;">
        Print / Save PDF
      </button>
      <button onclick="window.close()" style="background: #e2e8f0; color: #475569; border: none; padding: 8px 14px; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer;">
        Close
      </button>
    </div>
  </div>

  <div class="header">
    <div>
      <div class="brand-name">NERAVU</div>
      <div class="brand-sub">Medical Companion & Transport Records</div>
    </div>
    <div class="report-meta">
      <div>Report Generated: <strong>${timestamp}</strong></div>
      ${options.userName ? `<div>User: <strong>${escapeHtml(options.userName)}</strong> (${escapeHtml(options.userRole || 'Member')})</div>` : ''}
      <div class="report-badge">Filter View: ${escapeHtml(filterTitle)}</div>
    </div>
  </div>

  <div class="summary-cards">
    <div class="card">
      <div class="card-label">Total in View</div>
      <div class="card-value">${journeys.length}</div>
    </div>
    <div class="card">
      <div class="card-label">Upcoming</div>
      <div class="card-value" style="color: #2563eb;">${upcomingCount}</div>
    </div>
    <div class="card">
      <div class="card-label">Completed</div>
      <div class="card-value" style="color: #059669;">${completedCount}</div>
    </div>
    <div class="card">
      <div class="card-label">Cancelled</div>
      <div class="card-value" style="color: #dc2626;">${cancelledCount}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="text-align: left; width: 80px;">Ref ID</th>
        <th style="text-align: left; width: 140px;">Date & Timing</th>
        <th style="text-align: left;">Hospital & Transit Route</th>
        <th style="text-align: center; width: 110px;">Status</th>
        <th style="text-align: right; width: 90px;">Fare</th>
      </tr>
    </thead>
    <tbody>
      ${tableRowsHtml}
    </tbody>
  </table>

  <div class="footer">
    <div>NERAVU Healthcare Transit Support System • Bangalore & Karnataka Region</div>
    <div>Page 1 of 1 • Official User Record • Total Billed: ₹ ${totalFare.toFixed(2)}</div>
  </div>

  <script>
    // Automatically trigger print dialog when window loads
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        window.print();
      }, 400);
    });
  </script>
</body>
</html>
  `;

  // Open printable window for clean browser-native PDF generation
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(printableHtml);
    printWindow.document.close();
  } else {
    // If pop-up was blocked, fallback to creating an iframe to trigger print
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(printableHtml);
      doc.close();
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }

    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 60000);
  }
};

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
