// Lightweight, dependency-free fuzzy matching for filtering short text fields
// (relay names, descriptions, tags). Returns a score where higher is a better
// match and 0 means no match. Tuned for typo tolerance so a query like "bitcon"
// still ranks a "bitcoin" relay highly — fixing the old exact-spelling-only
// search. Cheap enough to run client-side over a bounded list every keystroke.

/** Score a single query against a single text. Higher = better; 0 = no match. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q || !t) return 0;

  if (t === q) return 1000;
  if (t.startsWith(q)) return 850;
  const idx = t.indexOf(q);
  if (idx >= 0) return 700 - Math.min(idx, 100); // earlier substring ranks higher

  // Per-token matching with typo tolerance. Lets "bitcon dev" match
  // "bitcoin-dev" and survive small misspellings.
  const qTokens = q.split(/\s+/).filter(Boolean);
  const tTokens = t.split(/[\s\-_/.,:]+/).filter(Boolean);
  let tokenScore = 0;
  for (const qt of qTokens) {
    let best = 0;
    for (const tt of tTokens) {
      if (tt === qt) { best = Math.max(best, 200); continue; }
      if (tt.startsWith(qt)) { best = Math.max(best, 160); continue; }
      if (tt.includes(qt)) { best = Math.max(best, 120); continue; }
      const maxEdits = qt.length <= 4 ? 1 : 2;
      const d = boundedLevenshtein(qt, tt, maxEdits);
      if (d >= 0) best = Math.max(best, 100 - d * 20);
    }
    tokenScore += best;
  }
  if (tokenScore > 0) return tokenScore;

  // Last resort: in-order subsequence of the whole query across the text.
  if (isSubsequence(q.replace(/\s+/g, ""), t)) return 50;
  return 0;
}

/** Best score of a query across several candidate fields (name, desc, tags…). */
export function fuzzyScoreFields(query: string, fields: (string | undefined | null)[]): number {
  let best = 0;
  for (const f of fields) {
    if (!f) continue;
    const s = fuzzyScore(query, f);
    if (s > best) best = s;
  }
  return best;
}

function isSubsequence(q: string, t: string): boolean {
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) i++;
  }
  return i === q.length;
}

/** Levenshtein distance with early bail-out: returns -1 once the distance is
 *  guaranteed to exceed maxEdits, so typo checks stay O(len·maxEdits)-ish. */
function boundedLevenshtein(a: string, b: string, maxEdits: number): number {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > maxEdits) return -1;
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxEdits) return -1;
    const tmp = prev; prev = curr; curr = tmp;
  }
  const d = prev[lb];
  return d <= maxEdits ? d : -1;
}
