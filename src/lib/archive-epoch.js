// Storage epochs are local archive namespaces, not upstream generations or identities.
export function storageEpoch(value) {
  const epoch = value?.storage_epoch === undefined ? 0 : value.storage_epoch;
  if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch > 999999) throw Error('Invalid archive storage epoch');
  return epoch;
}
export function archiveGroup(generation, epoch = 0) {
  const g = String(generation ?? 'unknown');
  if (!/^(?:\d{1,6}|unknown)$/.test(g)) throw Error('Invalid archive generation');
  const e = storageEpoch({storage_epoch:epoch});
  return `g${g}${e ? `e${e}` : ''}`;
}
export function splitArchiveGroup(group) {
  const match = /^g(\d{1,6}|unknown)(?:e(\d{1,6}))?$/.exec(group);
  if (!match) throw Error('Invalid archive group');
  return {generation:match[1], storage_epoch:Number(match[2] || 0)};
}
// Older collectors reused the same files/maps on resets. Their mixed bytes cannot be
// repaired by inventing an epoch now; readers must refuse that affected legacy group.
export function legacyAmbiguousGenerations(captures, room) {
  const seen = new Set(), bad = new Set(); let last;
  for (const c of captures) {
    if (!c.ok || c.room !== room) continue;
    const generation = String(c.generation ?? 'unknown');
    if (c.storage_epoch == null && c.new_records && (c.events?.some(e=>e.type==='seq_regression') || seen.has(generation) && last !== generation)) bad.add(generation);
    if (c.new_records) seen.add(generation);
    last = generation;
  }
  return [...bad];
}
