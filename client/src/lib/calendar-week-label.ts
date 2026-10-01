/**
 * The week ribbon names the days it shows. It used to name the month most
 * of the week sat in ("OCTOBER" over Sep 27 – Oct 3), which applied to three
 * days of seven.
 */
const MONTH = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });

export function weekRangeLabel(weekStart: Date): string {
  const end = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
  const sameMonth = end.getMonth() === weekStart.getMonth() && end.getFullYear() === weekStart.getFullYear();
  const year = end.getFullYear() !== weekStart.getFullYear() ? `, ${end.getFullYear()}` : "";
  return sameMonth
    ? `${MONTH(weekStart)} ${weekStart.getDate()} – ${end.getDate()}`
    : `${MONTH(weekStart)} ${weekStart.getDate()} – ${MONTH(end)} ${end.getDate()}${year}`;
}
