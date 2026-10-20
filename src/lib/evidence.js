// Evidence review: compares each result with what its own task asked for, using only the records.
//
// Deterministic and explainable: every conclusion names the task wording and the result text it rests on.
// It never scores usefulness and never reports anything as verified: Proofline re-runs nothing, so
// independent reproduction is always "not performed". A result can at best be "supported": it addresses
// the task's specifics and contains the parts the task requires, as claims.
//
//   const index = buildReuseIndex(allRecords);           // once per set of records
//   const review = reviewCase(caseRecords, { index });   // per case
export const EVIDENCE_VERSION = '2'; // 2: off-task by word overlap; no plain-answer check; evidence quality kept out of the class

const RESPONSE_KINDS = ['ACCEPT', 'CLAIM', 'SUBMIT', 'RESULT', 'DELIVER', 'VOUCH', 'ATTEST'];

// --- What the task asks for ----------------------------------------------------------------------

// "Do not ACCEPT, SUBMIT, or VOUCH", "do not reply", "Do not ... perform any other action". Protocol words
// must be in capitals, so ordinary English ("do not accept results that...") is not read as a prohibition.
export function prohibitions(taskText) {
  const out = new Set();
  for (const m of String(taskText).matchAll(/\bdo not\b([^.;]*)/gi)) {
    const clause = m[1];
    if (/\b(reply|respond)\b|any other action|any action/i.test(clause)) RESPONSE_KINDS.forEach((k) => out.add(k));
    for (const k of RESPONSE_KINDS) if (new RegExp(`\\b${k}\\b`).test(clause)) out.add(k);
  }
  // Credence names: ACCEPT ~ CLAIM, SUBMIT ~ RESULT/DELIVER, VOUCH ~ ATTEST.
  const alias = { ACCEPT: ['CLAIM'], SUBMIT: ['RESULT', 'DELIVER'], VOUCH: ['ATTEST'] };
  for (const [k, v] of Object.entries(alias)) if (out.has(k)) v.forEach((x) => out.add(x));
  return [...out];
}

export function exactReply(taskText) {
  const m = /reply with exactly\s*[:]?\s*['"‘“]([^'"’”]{1,200})['"’”]/i.exec(String(taskText));
  return m ? m[1].trim() : null;
}

export function successClause(taskText) {
  const m = /\bsuccess(?:\s+(?:means|criteria|condition))?\s*[:=]\s*([\s\S]+)/i.exec(String(taskText));
  return m ? m[1].trim() : null;
}

// Deliverables named in the success clause, each with a text check. Wording without a check is not listed:
// the review shows only what it can actually look for.
const DELIVERABLES = [
  { id: 'url', label: 'URLs', ask: /\burls?\b|\blinks?\b/i, has: (t) => /https?:\/\/\S+|(^|[\s(])\/[a-z][\w./?=&%-]*/i.test(t) },
  { id: 'status', label: 'HTTP status', ask: /\bhttp (codes?|status(es)?)\b|\bstatus codes?\b|\bstatus\b/i, has: (t) => /\bHTTP(\/[\d.]+)?\s*[1-5]\d\d\b|\bstatus(\s+code)?\s*[:=]?\s*[1-5]\d\d\b|\b[1-5]\d\d\s+(OK|Created|Bad Request|Unauthorized|Forbidden|Not Found|Conflict|Too Many)/i.test(t) },
  { id: 'body', label: 'response body', ask: /\bbody\b|\bresponse\b/i, has: (t) => /\bbody\s*[:=]|\{[^{}]{2,}\}|"[^"]{3,}"|'[^']{3,}'|`[^`]{3,}`/i.test(t) },
  { id: 'count', label: 'message counts', ask: /\b(message )?counts?\b/i, has: (t) => /\b(count|messages|records|entries)\s*[:=]\s*\d+|\b\d+\s+(messages|records|entries|items)\b/i.test(t) },
  { id: 'hash', label: 'hashes', ask: /\bsha-?\d+|\bsha12\b|\bhash(es)?\b/i, has: (t) => /\b[0-9a-f]{12,64}\b/i.test(t) },
  { id: 'pattern', label: 'quoted constraint strings', ask: /\bconstraint strings?\b|\bregex\b|\bpatterns?\b/i, has: (t) => /\^\S{3,}\$|\/\^\S+\$\//.test(t) },
  { id: 'command', label: 'commands', ask: /\bcommands?\b/i, has: (t) => /`[^`]+`|(^|\n)\s*\$\s+\S|\b(kubectl|curl|git|npm|docker|psql|gh|node|python3?)\s+\S/.test(t) },
  { id: 'query', label: 'SQL query', ask: /\b(sql|query)\b/i, has: (t) => /\bselect\b[\s\S]{1,400}\bfrom\b/i.test(t) },
];
const NUMBER_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

export function deliverables(clause) {
  if (!clause) return [];
  const asked = DELIVERABLES.filter((d) => d.ask.test(clause)).map(({ id, label }) => ({ id, label }));
  // "3 improvements", "the 2 most likely causes": a number of items.
  const m = /\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?:most|concrete|specific|distinct|key|likely|main|different|separate)\s+){0,3}([a-z]+)/i.exec(clause);
  if (m) { const n = Number(m[1]) || NUMBER_WORDS[m[1].toLowerCase()]; if (n >= 2 && n <= 10 && !/^(chars?|characters?|bytes?|minutes?|seconds?|hours?|days?|percent)$/i.test(m[2])) asked.push({ id: 'items', label: `${n} ${m[2]}`, n }); }
  return asked;
}

function countItems(t) {
  const lines = String(t).split(/\n/).filter((l) => /^\s*([-*•]|\d+[.)])\s+\S/.test(l)).length;
  const inline = (String(t).match(/(?:^|\s)\(?\d{1,2}[.)]\s+\S/g) || []).length;
  return Math.max(lines, inline);
}

function checkDeliverable(d, text) {
  if (d.id === 'items') return countItems(text) >= d.n;
  return DELIVERABLES.find((x) => x.id === d.id).has(text);
}

// The task's own specifics: paths, file names, code, quoted strings, numbers. A result that answers the task
// usually mentions some of them; one that mentions none was probably written for something else.
export function specifics(taskText, id) {
  const t = String(taskText).replace(/^\s*\w+\s+v1\s*\|\s*[^|]+\|\s*[^|]*\|/, ' ');   // drop kind, ID and category
  const out = [];
  const add = (s) => { s = s.trim().replace(/[.,;:)]+$/, ''); if (s.length >= 2 && s !== id && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s); };
  for (const m of t.matchAll(/`([^`]{2,60})`/g)) add(m[1]);
  for (const m of t.matchAll(/(?:^|[\s(])(\/[a-z][\w.-]*(?:\/[\w.-]+)*)/gi)) add(m[1]);           // paths, without query
  for (const m of t.matchAll(/\b[\w-]+\.(?:json|txt|py|js|mjs|ts|md|ya?ml|toml|sh|sql|go)\b/gi)) add(m[0]);
  for (const m of t.matchAll(/\b\d{2,}\b/g)) add(m[0]);
  for (const m of t.matchAll(/\b(?:d|p|mb|mb-p)-[a-z0-9_-]{3,}\b/g)) add(m[0]);
  return out.slice(0, 12);
}

// Content words, for a rough "is this about the same thing" measure.
const STOP = new Set(('that this with from what have will must whether only also into than then them they their there these those which while where '
  + 'when your about after before being both does each every other such some more most very just over under same independently actually exactly '
  + 'report state plainly submit success task vouch accept should would could using used make sure').split(' '));
const words = (t) => new Set((String(t).toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || []).filter((w) => !STOP.has(w)));
// Share of the task's words found in the result, and of the result's words found in the task.
export function overlap(taskText, resultText) {
  const tw = words(String(taskText).replace(/^\s*\w+\s+v1\s*\|\s*[^|]+\|\s*[^|]*\|/, ' ')), rw = words(resultText);
  let both = 0; for (const w of rw) if (tw.has(w)) both++;
  return { task: tw.size ? both / tw.size : 0, result: rw.size ? both / rw.size : 0 };
}
// Below both thresholds, with none of the task's specifics mentioned, a result is read as written for something else.
export const OFF_TASK = { task: 0.10, result: 0.25 };

// --- What the result shows -----------------------------------------------------------------------

// Text normalised so the same template posted under different jobs compares equal.
export function normalizeResult(body, id) {
  return String(body || '').split(id).join('<ID>').replace(/\b\d{6,}\b/g, '<N>').replace(/\bn=\d+/g, 'n=<N>')
    .replace(/range=[\d.]+/g, 'range=<R>').replace(/\s+/g, ' ').trim().toLowerCase();
}

// normalized result text -> Set of case IDs it was posted under
export function buildReuseIndex(records) {
  const index = new Map();
  for (const r of records) if (r.stage === 2 && r.body) { const k = normalizeResult(r.body, r.id); if (k.length >= 12) (index.get(k) || index.set(k, new Set()).get(k)).add(r.id); }
  return index;
}

const REFUSAL = /\bI (?:can(?:no|')t|cannot|won't|will not|am unable to|'m unable to) (?:assist|help|provide|fulfil+|comply|do that|complete)/i;
const REQUEST = /\b(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(https?:\/\/\S+|\/\S*)/g;

function evidenceIn(text) {
  const t = String(text);
  const requests = [...t.matchAll(REQUEST)].map((m) => `${m[1]} ${m[2]}`);
  const checkable = requests.length > 0 || /https?:\/\/\S+/.test(t) || /\b[0-9a-f]{12,64}\b/i.test(t) || /`[^`]+`|\^\S{3,}\$/.test(t)
    || (t.match(/\b\d+(\.\d+)?\b/g) || []).length >= 4;
  return { requests: [...new Set(requests)].slice(0, 8), checkable };
}

// --- Review -------------------------------------------------------------------------------------

const CLAIMS_REPRODUCED = /\b(reproduced|re-?ran|re-?fetched|independently (verified|confirmed|checked|re-?ran|fetched)|confirmed independently)\b/i;

export function reviewCase(list, { index = null } = {}) {
  const task = list.find((r) => r.stage === 0) || null;
  const results = list.filter((r) => r.stage === 2);
  const attests = list.filter((r) => r.stage === 3);
  const id = (task || list[0] || {}).id;
  if (!task) return { available: false, reason: 'no-request', results: [], violations: [], summary: null };

  const banned = prohibitions(task.text), exact = exactReply(task.text), clause = successClause(task.text);
  const asked = deliverables(clause), specs = specifics(task.text, id);
  const noSelfVouch = /\bno self-?vouch|\bno self-?attest/i.test(task.text);
  const resultKeys = new Set(results.map((r) => r.keyId).filter(Boolean));
  const violations = list.filter((r) => r.stage !== 0 && banned.includes(r.kind)).map((r) => ({ seq: r.seq, kind: r.kind, why: 'the task says not to post this' }));
  if (noSelfVouch) for (const a of attests) if (a.keyId && resultKeys.has(a.keyId)) violations.push({ seq: a.seq, kind: a.kind, why: 'the task says no self-vouch, and this key posted a result here' });

  const reviewed = results.map((r) => {
    const text = r.body || '';
    const reusedIn = index ? Math.max(0, (index.get(normalizeResult(text, r.id))?.size || 1) - 1) : 0;
    const found = specs.filter((s) => text.toLowerCase().includes(s.toLowerCase()));
    const parts = asked.map((d) => ({ ...d, present: checkDeliverable(d, text) }));
    const ev = evidenceIn(text);
    const refusal = REFUSAL.test(text), ov = overlap(task.text, text);
    const offTask = !refusal && !found.length && ov.task < OFF_TASK.task && ov.result < OFF_TASK.result;
    const reasons = [];
    let cls;
    if (banned.includes(r.kind)) { cls = 'noncompliant'; reasons.push('The task says not to submit at all.'); }
    else if (exact && text.trim() !== exact) { cls = 'noncompliant'; reasons.push(`The task asks for exactly "${exact}".`); }
    else if (refusal) { cls = 'insufficient'; reasons.push('A refusal, not a result.'); }
    else if (offTask) { cls = 'noncompliant'; reasons.push(`Written for something else: it shares almost no words with the task (${Math.round(ov.task * 100)}% of the task’s words) and mentions none of its specifics${specs.length ? ` (${specs.slice(0, 4).join(', ')}${specs.length > 4 ? ', …' : ''})` : ''}.`); }
    else if (reusedIn >= 2) { cls = 'insufficient'; }
    else if (parts.some((p) => !p.present)) { cls = 'insufficient'; reasons.push(`Required by the task but not found: ${parts.filter((p) => !p.present).map((p) => p.label).join(', ')}.`); }
    else { cls = 'supported'; reasons.push(asked.length ? `On the task’s subject, and contains every part it requires that can be looked for (${asked.map((p) => p.label).join(', ')}).` : 'On the task’s subject; the task names no parts that can be looked for.'); }
    if (!ev.checkable && !refusal) reasons.push('Gives no detail a reader could re-run or check: no request, link, hash, code or measurements.');
    if (reusedIn >= 2) reasons.push(`The same text was posted under ${reusedIn} other ${reusedIn === 1 ? 'task' : 'tasks'}.`);
    return { seq: r.seq, kind: r.kind, key: r.keyId, class: cls, reasons, parts, specifics: { found, total: specs.length }, overlap: { task: Math.round(ov.task * 100), result: Math.round(ov.result * 100) }, reusedIn, refusal, requests: ev.requests, checkable: ev.checkable };
  });

  // Attestations that call a result useful when no result in the case is supported.
  const best = reviewed.some((x) => x.class === 'supported') ? 'supported' : reviewed.some((x) => x.class === 'insufficient') ? 'insufficient' : reviewed.length ? 'noncompliant' : null;
  const positive = attests.filter((a) => a.verdict === 'useful');
  const claimsRepro = attests.filter((a) => CLAIMS_REPRODUCED.test(a.body || '')).length;

  // The three rows, as plain statements.
  let compliance, evidence, assessment;
  if (violations.length && banned.length) {
    compliance = { level: 'violated', text: `Violated: the task says not to ${banned.includes('SUBMIT') ? 'respond' : 'post ' + banned.join('/')}, and ${violations.length} ${violations.length === 1 ? 'record does' : 'records do'}` };
  } else if (!reviewed.length) compliance = { level: 'none', text: 'No result to compare' };
  else if (best === 'supported') compliance = { level: 'supported', text: asked.length ? 'Required parts present in at least one result' : 'At least one result addresses the task’s specifics' };
  else if (best === 'insufficient') compliance = { level: 'partial', text: 'Not shown: required parts missing, a refusal, or reused text' };
  else compliance = { level: 'not-met', text: 'Not met: no result addresses this task' };
  const top = reviewed.find((x) => x.class === best);
  if (!top) evidence = { level: 'none', text: 'None' };
  else if (top.refusal) evidence = { level: 'none', text: 'None: the result is a refusal' };
  else if (top.reusedIn >= 2) evidence = { level: 'reused', text: `Reused text, posted under ${top.reusedIn} other tasks` };
  else if (!top.checkable) evidence = { level: 'asserted', text: 'Asserted only: nothing a reader could re-run or check' };
  else evidence = { level: 'checkable', text: `Concrete claims${top.requests.length ? ` (${top.requests.length} ${top.requests.length === 1 ? 'request' : 'requests'} named)` : ''}, not re-run` };
  const reproduction = { level: 'not-performed', text: `Not performed by Proofline${claimsRepro ? ` · ${claimsRepro} ${claimsRepro === 1 ? 'attestation claims' : 'attestations claim'} to have reproduced it (a claim, not checked)` : ''}` };
  const posNote = positive.length && best !== 'supported' ? ` ${positive.length} ${positive.length === 1 ? 'attestation calls' : 'attestations call'} it useful anyway.` : '';
  if (compliance.level === 'violated') assessment = `The task asked for no response, and the protocol chain was filled in anyway.${posNote} A complete chain here is the failure, not the success.`;
  else if (compliance.level === 'none') assessment = 'There is no result to compare with the task.';
  else if (best === 'supported') assessment = 'At least one result contains what the task asks for, as claims. Nobody’s claims were re-run here, so this shows the result is on point, not that it is correct.';
  else if (best === 'insufficient') assessment = `The records do not show the task was done.${posNote}`;
  else assessment = `No result addresses what this task asks.${posNote}`;

  return {
    available: true, version: EVIDENCE_VERSION,
    requirements: { prohibited: banned, exactReply: exact, successClause: clause, deliverables: asked, specifics: specs, noSelfVouch },
    results: reviewed, violations, positiveAttestations: positive.length,
    summary: { class: compliance.level === 'violated' ? 'noncompliant' : best, compliance, evidence, reproduction, assessment },
  };
}
