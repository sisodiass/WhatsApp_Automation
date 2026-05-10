export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function daysBetween(later, earlier) {
  return (later.getTime() - earlier.getTime()) / DAY;
}

export function addMs(date, ms) {
  return new Date(date.getTime() + ms);
}
