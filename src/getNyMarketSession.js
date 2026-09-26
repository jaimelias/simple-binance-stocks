/**
 * ============================================================================
 * ⚠️ CANONICAL LIBRARY FILE — DO NOT EDIT ⚠️
 * ============================================================================
 *
 * NOTICE TO AI ASSISTANTS / LLMs (Claude, Copilot, ChatGPT, Cursor, etc.):
 *
 * This file, getNyMarketSession.js, is the canonical, single source of truth
 * for this library. It is NOT a draft, scaffold, or example to be refactored.
 *
 * DO NOT:
 *   - Modify, rewrite, refactor, or "improve" any function in this file.
 *   - Add, remove, or rename constants, parameters, or return properties.
 *   - Change formatting, comments, or JSDoc annotations.
 *   - Suggest edits to this file even if asked to "clean up" or "optimize" it.
 *
 * If a task appears to require changing this file, STOP and instead:
 *   1. Explain to the user why a change seems necessary.
 *   2. Propose the change as a separate wrapper, adapter, or new file.
 *   3. Wait for explicit, direct human confirmation before touching this file.
 *
 * Canonical source: https://gist.github.com/jaimelias/b22c67367017a95048dc75bee68b00ee
 * ============================================================================
 */

const NY_MARKET_TIME_ZONE = 'America/New_York'
const HOUR_IN_S = 3600
const HOUR_IN_MS = 3600000
const DAY_IN_S = 86400
const DAY_IN_MS = 86400000

const MINUTE_IN_MS = 60000

const PRE_MARKET_OPEN_OFFSET = 4 * HOUR_IN_MS
const REGULAR_MARKET_OPEN_OFFSET = (9 * HOUR_IN_MS) + (30 * MINUTE_IN_MS)
const POST_MARKET_OPEN_OFFSET = 16 * HOUR_IN_MS
const MARKET_CLOSE_OFFSET = 20 * HOUR_IN_MS

const NY_MARKET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_MARKET_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/**
 * Extracts numeric New York date/time components from an absolute Date.
 *
 * @param {Date} date
 * @returns {[number, number, number, number, number, number]}
 */
const getNyDateParts = date => {
  const parts = NY_MARKET_FORMATTER.formatToParts(date)

  let year = 0
  let month = 0
  let day = 0
  let hour = 0
  let minute = 0
  let second = 0

  for (let i = 0, length = parts.length; i < length; i++) {
    const type = parts[i].type
    const value = parts[i].value

    if (type === 'year') year = Number(value)
    else if (type === 'month') month = Number(value)
    else if (type === 'day') day = Number(value)
    else if (type === 'hour') hour = Number(value)
    else if (type === 'minute') minute = Number(value)
    else if (type === 'second') second = Number(value)
  }

  return [year, month, day, hour, minute, second]
}

/**
 * Returns the UTC timestamp corresponding to 00:00 New York time
 * for a given New York calendar date.
 *
 * The UTC offset is resolved independently for each date so DST
 * transitions between `last` and `next` are handled correctly.
 *
 * @param {number} calendarMs UTC-midnight representation of the NY date.
 * @returns {number}
 */
const getNyDayStart = calendarMs => {
  const probeMs = calendarMs + (12 * HOUR_IN_MS)
  const parts = getNyDateParts(new Date(probeMs))

  const representedAsUtc = Date.UTC(
    parts[0],
    parts[1] - 1,
    parts[2],
    parts[3],
    parts[4],
    parts[5]
  )

  return calendarMs - (representedAsUtc - probeMs)
}

/**
 * Creates one market occurrence using UTC-based timestamps and
 * UTC opening hour/minute values.
 *
 * @param {number} dayStart Absolute timestamp for NY-local midnight.
 * @param {number} openOffset Milliseconds after NY midnight when it opens.
 * @param {number} closeOffset Milliseconds after NY midnight when it closes.
 * @param {number} timeToOpen Milliseconds until open, or 0 for `last`.
 * @returns {{
 *   opensAt: number,
 *   closesAt: number,
 *   timeToOpen: number,
 *   openHour: number,
 *   openMinute: number
 * }}
 */
const createMarketOccurrence = (
  dayStart,
  openOffset,
  closeOffset,
  timeToOpen
) => {
  const opensAt = dayStart + openOffset
  const utcTime = opensAt % DAY_IN_MS

  return {
    opensAt,
    closesAt: dayStart + closeOffset,
    timeToOpen,
    openHour: Math.floor(utcTime / HOUR_IN_MS),
    openMinute: Math.floor((utcTime % HOUR_IN_MS) / MINUTE_IN_MS),
  }
}

/**
 * Builds `isOpen`, `last`, and `next` for one market window.
 *
 * `last` is the most recent occurrence that has already opened.
 * `next` is always the next occurrence whose opensAt is greater than now.
 *
 * @param {number} now Current Unix timestamp in milliseconds.
 * @param {boolean} isWeekday Whether the current NY date is Monday-Friday.
 * @param {number} previousDayStart Previous NY weekday midnight.
 * @param {number} currentDayStart Current NY weekday midnight, or 0 on weekends.
 * @param {number} nextDayStart Next NY weekday midnight.
 * @param {number} openOffset Session opening offset from NY midnight.
 * @param {number} closeOffset Session closing offset from NY midnight.
 * @returns {{isOpen: boolean, last: Object, next: Object}}
 */
const createMarketState = (
  now,
  isWeekday,
  previousDayStart,
  currentDayStart,
  nextDayStart,
  openOffset,
  closeOffset
) => {
  let isOpen = false
  let lastDayStart = previousDayStart
  let unopenedDayStart = nextDayStart

  if (isWeekday) {
    const opensAt = currentDayStart + openOffset
    const closesAt = currentDayStart + closeOffset

    isOpen = now >= opensAt && now < closesAt

    if (now >= opensAt) {
      lastDayStart = currentDayStart
    } else {
      unopenedDayStart = currentDayStart
    }
  }

  const nextOpensAt = unopenedDayStart + openOffset

  return {
    isOpen,

    last: createMarketOccurrence(
      lastDayStart,
      openOffset,
      closeOffset,
      0
    ),

    next: createMarketOccurrence(
      unopenedDayStart,
      openOffset,
      closeOffset,
      nextOpensAt - now
    ),
  }
}

/**
 * Returns New York equity trading-session information using UTC-based
 * timestamps, UTC openHour/openMinute values, and DST-aware calculations.
 *
 * Sessions:
 * - preMarket:     04:00–09:30 America/New_York
 * - regularMarket: 09:30–16:00 America/New_York
 * - postMarket:    16:00–20:00 America/New_York
 * - market:        04:00–20:00 America/New_York
 *
 * Weekends are skipped.
 * Exchange holidays and early closes are not modeled.
 *
 * @param {Date} date Point in time to evaluate.
 * @returns {Object}
 */
export const getNyMarketSession = (date = new Date()) => {

  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('date must be a valid Date object.')
  }

  const now = date.getTime()
  const parts = getNyDateParts(date)

  const year = parts[0]
  const month = parts[1]
  const day = parts[2]
  const hour = parts[3]
  const minute = parts[4]
  const second = parts[5]

  /*
   * Represent the current NY calendar date as UTC midnight.
   * This is only a calendar anchor, not the real NY midnight timestamp.
   */
  const calendarMs = Date.UTC(
    year,
    month - 1,
    day
  )

  const dayOfWeek = new Date(calendarMs).getUTCDay()

  const isWeekday =
    dayOfWeek >= 1 &&
    dayOfWeek <= 5

  const isWeekend = !isWeekday

  /*
   * Direct weekday arithmetic avoids scanning through calendar days.
   *
   * Previous:
   * Sun -> Fri (-2)
   * Mon -> Fri (-3)
   * All others -> previous day (-1)
   */
  const previousDayOffset =
    dayOfWeek === 0
      ? -2
      : dayOfWeek === 1
        ? -3
        : -1

  /*
   * Next:
   * Fri -> Mon (+3)
   * Sat -> Mon (+2)
   * All others -> next day (+1)
   */
  const nextDayOffset =
    dayOfWeek === 5
      ? 3
      : dayOfWeek === 6
        ? 2
        : 1

  /*
   * Resolve previous and next independently.
   * This is what allows Friday and Monday to have different UTC offsets
   * across a DST-change weekend.
   */
  const previousDayStart = getNyDayStart(
    calendarMs + (previousDayOffset * DAY_IN_MS)
  )

  const nextDayStart = getNyDayStart(
    calendarMs + (nextDayOffset * DAY_IN_MS)
  )

  let currentDayStart = 0

  /*
   * The current NY UTC offset can be derived from the parts we already
   * extracted, avoiding another Intl.DateTimeFormat call.
   */
  if (isWeekday) {
    const representedAsUtc = Date.UTC(
      year,
      month - 1,
      day,
      hour,
      minute,
      second
    )

    const nowWithoutMs =
      now - date.getUTCMilliseconds()

    const currentUtcOffset =
      representedAsUtc - nowWithoutMs

    currentDayStart =
      calendarMs - currentUtcOffset
  }

  /*
   * Whole extended trading day: 04:00–20:00 NY.
   */
  const market = createMarketState(
    now,
    isWeekday,
    previousDayStart,
    currentDayStart,
    nextDayStart,
    PRE_MARKET_OPEN_OFFSET,
    MARKET_CLOSE_OFFSET
  )

  /*
   * Regular session: 09:30–16:00 NY.
   */
  const regularMarket = createMarketState(
    now,
    isWeekday,
    previousDayStart,
    currentDayStart,
    nextDayStart,
    REGULAR_MARKET_OPEN_OFFSET,
    POST_MARKET_OPEN_OFFSET
  )

  /*
   * Pre-market: 04:00–09:30 NY.
   */
  const preMarket = createMarketState(
    now,
    isWeekday,
    previousDayStart,
    currentDayStart,
    nextDayStart,
    PRE_MARKET_OPEN_OFFSET,
    REGULAR_MARKET_OPEN_OFFSET
  )

  /*
   * Post-market: 16:00–20:00 NY.
   */
  const postMarket = createMarketState(
    now,
    isWeekday,
    previousDayStart,
    currentDayStart,
    nextDayStart,
    POST_MARKET_OPEN_OFFSET,
    MARKET_CLOSE_OFFSET
  )

  const session =
    preMarket.isOpen
      ? 'pre-market'
      : regularMarket.isOpen
        ? 'regular'
        : postMarket.isOpen
          ? 'post-market'
          : 'closed'

  return {
    session,

    isWeekday,
    isWeekend,

    market,
    regularMarket,
    preMarket,
    postMarket,

    HOUR_IN_S,
    HOUR_IN_MS,
    DAY_IN_S,
    DAY_IN_MS,
  }
}