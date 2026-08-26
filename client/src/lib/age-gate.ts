/**
 * Neutral age screen for disabling the sensitive-content filter.
 *
 * Google Play's incidental-sexual-content rule (support answer/12923286)
 * requires that a default-ON content filter can only be disabled behind
 * (a) a NEUTRAL age screen — ask date of birth without hinting the
 * required answer — and (b) at least two deliberate actions. The Settings
 * toggle supplies the deliberate actions (toggle + explicit confirm);
 * this module supplies the age math and the once-per-device pass record.
 *
 * Neutrality matters: nothing here (or in the dialog copy) says what age
 * unlocks the filter, and an under-age answer is refused without saying
 * what would have passed.
 */

const AGE_OK_KEY = "ro-age-screen-passed";

/**
 * true when the YYYY-MM-DD birth date makes the person at least 18 on
 * `now`. Invalid or future dates are never adult — a gate must fail
 * closed on garbage input.
 */
export function isAdultBirthDate(isoDate: string, now: Date): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const birth = new Date(y, mo - 1, d);
  // Reject impossible dates that Date silently rolls over (e.g. Feb 30).
  if (birth.getFullYear() !== y || birth.getMonth() !== mo - 1 || birth.getDate() !== d) return false;
  if (birth.getTime() > now.getTime()) return false;
  let age = now.getFullYear() - y;
  const beforeBirthday =
    now.getMonth() < mo - 1 || (now.getMonth() === mo - 1 && now.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 18;
}

/** Has this device already passed the age screen? */
export function hasPassedAgeScreen(): boolean {
  try {
    return localStorage.getItem(AGE_OK_KEY) === "1";
  } catch {
    return false;
  }
}

/** Record a pass so the screen is asked at most once per device. */
export function recordAgeScreenPassed(): void {
  try {
    localStorage.setItem(AGE_OK_KEY, "1");
  } catch {}
}
