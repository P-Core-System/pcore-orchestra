/**
 * Inline SVG chart primitives for the Tokens page.
 * No external charting library — pure SVG, self-contained, spec-compliant.
 */

export interface TokenBarData {
  label: string;
  value: number;
  budget: number;
  color: string;
}

/** Simple horizontal bar chart — used for byAgent / byPhase totals. */
export function renderBarChart(
  data: TokenBarData[],
  options: { width?: number; height?: number; maxBars?: number } = {}
): string {
  const { width = 600, height: _height = 300, maxBars = 15 } = options;
  const visible = data.slice(0, maxBars);
  const maxVal = Math.max(...visible.map((d) => Math.max(d.value, d.budget)), 1);
  const barHeight = 20;
  const gap = 8;
  const labelWidth = 140;
  const chartWidth = width - labelWidth - 40;
  const chartHeight = visible.length * (barHeight + gap) + 20;

  const bars = visible
    .map((d, i) => {
      const y = 20 + i * (barHeight + gap);
      const valueWidth = (d.value / maxVal) * chartWidth;
      const budgetWidth = (d.budget / maxVal) * chartWidth;
      const overBudget = d.value > d.budget;
      return `
        <g transform="translate(${labelWidth}, ${y})">
          <text x="-8" y="${barHeight / 2 + 4}" text-anchor="end" font-size="11" fill="#71717a" font-family="system-ui, sans-serif">${escapeHtml(d.label)}</text>
          <rect x="0" y="0" width="${budgetWidth}" height="${barHeight}" fill="#3f3f46" rx="3" />
          <rect x="0" y="0" width="${Math.min(valueWidth, budgetWidth)}" height="${barHeight}" fill="${d.color}" rx="3" />
          ${overBudget ? `<rect x="${budgetWidth}" y="0" width="${Math.min(valueWidth - budgetWidth, chartWidth - budgetWidth)}" height="${barHeight}" fill="#ef4444" rx="3" opacity="0.7" />` : ''}
          ${d.value > d.budget ? `<text x="${Math.min(valueWidth + 4, chartWidth)}" y="${barHeight / 2 + 4}" font-size="10" fill="#ef4444" font-family="system-ui, sans-serif">OVER</text>` : ''}
        </g>
      `;
    })
    .join('');

  const budgetLine = `
    <line x1="${labelWidth}" y1="10" x2="${labelWidth}" y2="${chartHeight + 10}" stroke="#52525b" stroke-dasharray="4,2" />
  `;

  return `
    <svg width="${width}" height="${chartHeight + 40}" viewBox="0 0 ${width} ${chartHeight + 40}" xmlns="http://www.w3.org/2000/svg" style="background: #18181b; border-radius: 8px;">
      <rect x="0" y="0" width="${width}" height="${chartHeight + 40}" fill="transparent" />
      ${budgetLine}
      ${bars}
    </svg>
  `;
}

/** Trend line chart — used for token trend over time. */
export interface TokenTrendPoint {
  at: string;
  total: number;
}

export function renderLineChart(
  points: TokenTrendPoint[],
  options: { width?: number; height?: number; color?: string } = {}
): string {
  const { width = 600, height = 200, color = '#38bdf8' } = options;
  if (points.length < 2) {
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><text x="${width/2}" y="${height/2}" text-anchor="middle" fill="#71717a" font-family="system-ui, sans-serif">Insufficient data for trend</text></svg>`;
  }

  const padding = 40;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  const values = points.map((p) => p.total);
  const maxVal = Math.max(...values, 1);
  const minVal = Math.min(...values);

  const xScale = (i: number) => padding + (i / (points.length - 1)) * chartWidth;
  const yScale = (val: number) => padding + chartHeight - ((val - minVal) / (maxVal - minVal || 1)) * chartHeight;

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(p.total)}`)
    .join(' ');

  const dots = points
    .map((p, i) => `<circle cx="${xScale(i)}" cy="${yScale(p.total)}" r="3" fill="${color}" />`)
    .join('');

  const xLabels = [0, Math.floor(points.length / 2), points.length - 1]
    .filter((i, idx, arr) => arr.indexOf(i) === idx)
    .map((i) => {
      const date = new Date(points[i].at);
      const label = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      return `<text x="${xScale(i)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="#71717a" font-family="system-ui, sans-serif">${escapeHtml(label)}</text>`;
    })
    .join('');

  const yLabels = [0, 0.5, 1]
    .map((ratio) => {
      const val = minVal + (maxVal - minVal) * ratio;
      const y = padding + chartHeight - ratio * chartHeight;
      return `<text x="${padding - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#71717a" font-family="system-ui, sans-serif">${Math.round(val).toLocaleString()}</text>`;
    })
    .join('');

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="background: #18181b; border-radius: 8px;">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent" />
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      ${dots}
      ${xLabels}
      ${yLabels}
    </svg>
  `;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&apos;');
}