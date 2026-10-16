const DAY_IN_MS = 86400000
const holidaysByYear = new Map()

// New York dates. Add newly announced full-day closures here, with their source.
// This is a maintained exception list, not a complete historical archive.
const AD_HOC_CLOSURES = new Set([
  // Hurricane Sandy:
  // https://ir.theice.com/press/news-details/2012/IntercontinentalExchange-Announces-Hurricane-Sandy-Market-Update/default.aspx
  '2012-10-29',
  '2012-10-30',
  // National Day of Mourning for President Jimmy Carter:
  // https://ir.theice.com/press/news-details/2024/The-New-York-Stock-Exchange-Will-Close-Markets-on-January-9-to-Honor-the-Passing-of-Former-President-Jimmy-Carter-on-National-Day-of-Mourning/default.aspx
  '2025-01-09',
].map(date => Date.parse(`${date}T00:00:00Z`)))

const nthWeekday = (year, month, weekday, occurrence) => {
  const first = Date.UTC(year, month - 1, 1)
  const offset = (weekday - new Date(first).getUTCDay() + 7) % 7
  return first + (offset + (occurrence - 1) * 7) * DAY_IN_MS
}

const observedDate = (year, month, day, observeSaturday = true) => {
  const date = Date.UTC(year, month - 1, day)
  const weekday = new Date(date).getUTCDay()
  if (weekday === 0) return date + DAY_IN_MS
  if (weekday === 6 && observeSaturday) return date - DAY_IN_MS
  return date
}

// Meeus/Jones/Butcher Gregorian Easter calculation, shifted back to Good Friday.
const goodFriday = year => {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = (h + l - 7 * m + 114) % 31 + 1
  return Date.UTC(year, month - 1, day - 2)
}

// Modern NYSE rules: https://www.nyse.com/trade/hours-calendars
// Whole years are generated on demand so last/next can cross coverage boundaries.
const getHolidays = year => {
  if (!holidaysByYear.has(year)) {
    holidaysByYear.set(year, new Set([
      observedDate(year, 1, 1, false), // New Year's Day: no Friday observance.
      nthWeekday(year, 1, 1, 3), // Martin Luther King Jr. Day
      nthWeekday(year, 2, 1, 3), // Washington's Birthday / Presidents' Day
      goodFriday(year),
      nthWeekday(year, 6, 1, 1) - 7 * DAY_IN_MS, // Last Monday in May
      observedDate(year, 6, 19), // Juneteenth
      observedDate(year, 7, 4), // Independence Day
      nthWeekday(year, 9, 1, 1), // Labor Day
      nthWeekday(year, 11, 4, 4), // Thanksgiving
      observedDate(year, 12, 25), // Christmas
    ]))
  }
  return holidaysByYear.get(year)
}

/**
 * Whether a NY calendar date is an observed full-day NYSE closure.
 * @param {number} calendarMs UTC-midnight representation of the NY date.
 * @returns {boolean} Weekends and early-close days are not holidays.
 */
export const isNyMarketHoliday = calendarMs => {
  const date = new Date(calendarMs)
  const weekday = date.getUTCDay()
  return weekday >= 1 && weekday <= 5 && (
    AD_HOC_CLOSURES.has(calendarMs) || getHolidays(date.getUTCFullYear()).has(calendarMs)
  )
}

/**
 * Find the preceding/following trading date using calendar anchors, not elapsed
 * NY-midnight timestamps, so DST changes do not shift the dates being searched.
 * @param {number} calendarMs UTC-midnight representation of the NY date.
 * @param {-1 | 1} direction Search backward or forward, excluding calendarMs.
 * @returns {number}
 */
export const getAdjacentNyTradingDate = (calendarMs, direction) => {
  while (true) {
    calendarMs += direction * DAY_IN_MS
    const weekday = new Date(calendarMs).getUTCDay()
    if (Number.isNaN(weekday)) throw new RangeError('No adjacent trading date within the supported Date range.')
    if (weekday >= 1 && weekday <= 5 && !isNyMarketHoliday(calendarMs)) return calendarMs
  }
}
