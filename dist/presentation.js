// Shared by the homepage, digest and link previews. No local-time formatting.
export function formatUTCWindow(from, to) {
  const stamp = (value) => {
    const d = new Date(value || NaN);
    if (!Number.isFinite(d.getTime())) return 'unknown';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${d.toISOString().slice(11, 16)}`;
  };
  return `${stamp(from)} – ${stamp(to)} UTC`;
}

export function formatUTCTime(value) {
  const d = new Date(value ?? NaN);
  return Number.isFinite(d.getTime()) ? d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'unknown';
}
export function liveRoomText(c, now = Date.now(), compact = false) {
  const age = (value) => {
    const ms = now - Date.parse(value);
    if (!Number.isFinite(ms)) return 'unknown age';
    if (ms < 0) return 'venue time ahead of clock';
    const s = Math.floor(ms / 1000);
    return s < 90 ? `${s} s ago` : s < 7200 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
  };
  const span = c.spanMs === null ? 'unknown span' : c.spanMs < 90000 ? `${Math.round(c.spanMs / 1000)} s` : c.spanMs < 7200000 ? `${Math.round(c.spanMs / 60000)} min` : `${Math.floor(c.spanMs / 3600000)} h ${Math.floor(c.spanMs % 3600000 / 60000)} min`;
  const delayed = c.status === 'error' ? ' · read delayed' : '';
  if (!c.lastOkAt) return `${c.room}: ${c.status === 'error' ? 'read delayed; no successful read' : 'loading'}`;
  if (c.roomEmpty === true) return `${c.room}: ${compact ? 'empty on last read' : `observed empty since ${formatUTCTime(c.emptySince)} (first observed here)`}${delayed}`;
  if (!c.records) return `${c.room}: no protocol records in held view${delayed}`;
  return `${c.room}: ${compact ? span + ' held' : `held window spans ${span}; last record ${age(c.windowEnd)}`}${delayed}`;
}

export function verdictCountText(negative,conflicts){
 const n=x=>x==null?'unavailable':Number(x).toLocaleString('en-US');
 return `${n(negative)} negative verdict records · ${n(conflicts)} same-result conflict cases`;
}
