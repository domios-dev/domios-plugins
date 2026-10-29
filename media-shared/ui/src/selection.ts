/** Local geometry only: callers must separately establish the target and revision. */
export type Point = { x: number; y: number };
export type Rect = Point & { w: number; h: number };
export function containPoint(x: number, y: number, boxWidth: number, boxHeight: number, mediaWidth: number, mediaHeight: number): Point | null {
  if (![x,y,boxWidth,boxHeight,mediaWidth,mediaHeight].every(Number.isFinite) || Math.min(boxWidth,boxHeight,mediaWidth,mediaHeight) <= 0) return null;
  const scale = Math.min(boxWidth / mediaWidth, boxHeight / mediaHeight);
  const width = mediaWidth * scale, height = mediaHeight * scale;
  const px = (x - (boxWidth - width) / 2) / width, py = (y - (boxHeight - height) / 2) / height;
  return px >= 0 && px <= 1 && py >= 0 && py <= 1 ? { x: px, y: py } : null;
}
export function region(a: Point, b: Point): Rect | null {
  if (![a.x,a.y,b.x,b.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  const x = Math.min(a.x,b.x), y = Math.min(a.y,b.y), w = Math.abs(a.x-b.x), h = Math.abs(a.y-b.y);
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}
export function timeRange(start: number, end: number, duration: number): { t0_ms: number; t1_ms: number } | null {
  return [start,end,duration].every(Number.isFinite) && duration > 0 && start >= 0 && start < end && end <= duration ? { t0_ms: start, t1_ms: end } : null;
}
export function textSpan(text: string, start: number, end: number): { start: number; end: number; quote: string } | null {
  const points = Array.from(text);
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && end <= points.length ? { start, end, quote: points.slice(start,end).join('') } : null;
}
