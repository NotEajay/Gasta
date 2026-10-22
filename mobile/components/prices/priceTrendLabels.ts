/** Chart annotation layout only. Never filters or changes the plotted series. */
export type PriceLabelPoint = { x: number; y: number; value: number };
export type PriceLabelPlacement = { index: number; left: number; top: number; width: number; height: number };

export function placePriceTrendLabels(
  points: readonly PriceLabelPoint[], plotWidth: number, plotHeight: number,
  labelWidth = 52, labelHeight = 16, headroom = 18,
): PriceLabelPlacement[] {
  if (!points.length || plotWidth <= 0 || plotHeight < labelHeight) return [];
  const width = Math.min(labelWidth, plotWidth);
  const latest = points.length - 1;
  const values = points.map(point => point.value);
  const low = values.indexOf(Math.min(...values));
  const high = values.indexOf(Math.max(...values));
  // Secondary local turns are considered only after the latest and extremes.
  const turns = points.map((point, index) => ({ index, prominence: index > 0 && index < latest &&
    ((point.value > values[index - 1] && point.value > values[index + 1]) ||
     (point.value < values[index - 1] && point.value < values[index + 1]))
    ? Math.abs(point.value - values[index - 1]) + Math.abs(point.value - values[index + 1]) : 0 }))
    .filter(turn => turn.prominence > 0).sort((a, b) => b.prominence - a.prominence || a.index - b.index);
  const candidates = [...new Set([latest, low, high, 0, ...turns.map(turn => turn.index)])];
  const placed: PriceLabelPlacement[] = [];
  const clampX = (left: number) => Math.max(0, Math.min(plotWidth - width, left));
  const collides = (a: PriceLabelPlacement, b: PriceLabelPlacement) =>
    a.left < b.left + b.width + 6 && a.left + a.width + 6 > b.left &&
    a.top < b.top + b.height + 4 && a.top + a.height + 4 > b.top;

  // Favor clear space around the curve as well as separation between labels.
  const curveHits = (box: PriceLabelPlacement) => {
    let hits = 0;
    for (let i = 1; i < points.length; i++) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const x = points[i - 1].x + (points[i].x - points[i - 1].x) * t;
        const y = points[i - 1].y + (points[i].y - points[i - 1].y) * t;
        if (x >= box.left + 2 && x <= box.left + box.width - 2 && y >= box.top + 2 && y <= box.top + box.height - 2) hits++;
      }
    }
    return hits;
  };

  for (const index of candidates) {
    const point = points[index];
    const lefts = [...new Set([clampX(point.x - width / 2), clampX(point.x - width + 4), clampX(point.x - 4)])];
    const belowFirst = index === low && low !== high;
    const tops = (belowFirst ? [point.y + 6, point.y - labelHeight - 6] : [point.y - labelHeight - 6, point.y + 6])
      .filter(top => top >= -headroom && top + labelHeight <= plotHeight);
    if (index === latest && !tops.length) tops.push(Math.max(-headroom, Math.min(plotHeight - labelHeight, point.y - labelHeight - 6)));
    let placement: PriceLabelPlacement | undefined;
    let bestScore = Infinity;
    for (const top of tops) {
      for (const left of lefts) {
        const box = { index, left, top, width, height: labelHeight };
        if (!placed.some(other => collides(box, other))) {
          const score = curveHits(box);
          if (score < bestScore) { placement = box; bestScore = score; }
        }
      }
    }
    if (placement) placed.push(placement);
    if (placed.length === 3) break;
  }
  return placed;
}
