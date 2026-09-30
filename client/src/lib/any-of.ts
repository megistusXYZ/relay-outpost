/**
 * True as soon as any check says true; false only once every check has said
 * false (or failed). For "did ANY relay serve us?": waiting for all of them
 * (Promise.all) held Discover tiles until the slowest relay's check gave up
 * (~8 s measured) though another had answered in well under a second.
 */
export function anyOf(checks: readonly Promise<boolean>[]): Promise<boolean> {
  if (checks.length === 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    let pending = checks.length;
    const settleNo = () => { if (--pending === 0) resolve(false); };
    for (const c of checks) {
      c.then((yes) => { if (yes) resolve(true); else settleNo(); }, settleNo);
    }
  });
}
