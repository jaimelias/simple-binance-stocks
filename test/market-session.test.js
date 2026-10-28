import test from 'node:test'
import assert from 'node:assert/strict'
import { getNyMarketSession } from '../src/utilities/getNyMarketSession.js'
import NodeClient from '../src/BinanceStocksNode.js'
import GasClient from '../src/BinanceStocksGas.js'

const DAY_IN_MS = 86400000
const HOUR_IN_MS = 3600000
const windows = { market: [4, 20], regularMarket: [9.5, 16], preMarket: [4, 9.5], postMarket: [16, 20] }
const sessionAt = date => getNyMarketSession(new Date(date))

// Independent fixtures from https://www.nyse.com/trade/hours-calendars
const holidays = {
  2026: ['01-01', '01-19', '02-16', '04-03', '05-25', '06-19', '07-03', '09-07', '11-26', '12-25'],
  2027: ['01-01', '01-18', '02-15', '03-26', '05-31', '06-18', '07-05', '09-06', '11-25', '12-24'],
  2028: ['01-17', '02-21', '04-14', '05-29', '06-19', '07-04', '09-04', '11-23', '12-25'],
}

for (const [year, dates] of Object.entries(holidays)) {
  test(`NYSE ${year}: every calendar date matches the published full-day closures`, () => {
    const expected = new Set(dates.map(date => `${year}-${date}`))
    for (let day = Date.UTC(Number(year), 0, 1); day < Date.UTC(Number(year) + 1, 0, 1); day += DAY_IN_MS) {
      const date = new Date(day).toISOString().slice(0, 10)
      const state = sessionAt(`${date}T12:00:00-05:00`)
      const weekday = new Date(day).getUTCDay()
      assert.equal(state.isHoliday, expected.has(date), date)
      assert.equal(state.isWeekday, weekday > 0 && weekday < 6, date)
      assert.equal(state.isWeekend, !state.isWeekday, date)
      assert.equal(state.regularMarket.isOpen, state.isWeekday && !expected.has(date), date)

      if (expected.has(date)) {
        // Exercise pre-market, regular trading and post-market on every holiday.
        for (const hour of ['05', '11', '18']) {
          const holiday = sessionAt(`${date}T${hour}:00:00-05:00`)
          assert.equal(holiday.session, 'closed', date)
          for (const name of Object.keys(windows)) assert.equal(holiday[name].isOpen, false, `${date} ${name}`)
        }
      }
    }
  })
}

const assertClosedOccurrences = (instant, previousMidnight, nextMidnight, isHoliday = true) => {
  const now = Date.parse(instant)
  const state = sessionAt(instant)
  assert.equal(state.isHoliday, isHoliday)
  assert.equal(state.session, 'closed')
  for (const [name, [open, close]] of Object.entries(windows)) {
    const window = state[name]
    assert.equal(window.isOpen, false, name)
    for (const [key, midnight] of [['last', previousMidnight], ['next', nextMidnight]]) {
      const opensAt = Date.parse(midnight) + open * HOUR_IN_MS
      const closesAt = Date.parse(midnight) + close * HOUR_IN_MS
      assert.deepEqual(window[key], {
        opensAt,
        closesAt,
        timeToOpen: key === 'last' ? 0 : opensAt - now,
        openHour: new Date(opensAt).getUTCHours(),
        openMinute: new Date(opensAt).getUTCMinutes(),
        closeHour: new Date(closesAt).getUTCHours(),
        closeMinute: new Date(closesAt).getUTCMinutes(),
      }, `${name}.${key}`)
    }
  }
  return state
}

test('last/next skip Friday and Monday holidays, observed holidays, and year boundaries', () => {
  const cases = [
    ['2026-11-26', '2026-11-25', '2026-11-27', '-05:00'],
    ['2026-12-25', '2026-12-24', '2026-12-28', '-05:00'],
    ['2027-01-01', '2026-12-31', '2027-01-04', '-05:00'],
    ['2027-01-18', '2027-01-15', '2027-01-19', '-05:00'],
    ['2027-03-26', '2027-03-25', '2027-03-29', '-04:00'],
    ['2027-06-18', '2027-06-17', '2027-06-21', '-04:00'],
    ['2027-07-05', '2027-07-02', '2027-07-06', '-04:00'],
  ]
  for (const [date, previous, next, offset] of cases) {
    const state = assertClosedOccurrences(`${date}T12:00:00${offset}`,
      `${previous}T00:00:00${offset}`, `${next}T00:00:00${offset}`)
    assert.equal(state.isWeekday, true)
    assert.equal(state.isWeekend, false)
  }
})

test('ad-hoc closure dates follow ordinary weekday sessions and last/next occurrences', () => {
  for (const [date, previous, next, offset] of [
    ['2025-01-09', '2025-01-08', '2025-01-10', '-05:00'],
    ['2012-10-29', '2012-10-26', '2012-10-30', '-04:00'],
    ['2012-10-30', '2012-10-29', '2012-10-31', '-04:00'],
  ]) {
    const midnight = Date.parse(`${date}T00:00:00${offset}`)
    const previousState = sessionAt(`${previous}T21:00:00${offset}`)
    const nextState = sessionAt(`${next}T03:00:00${offset}`)
    for (const [name, [open]] of Object.entries(windows)) {
      const opensAt = midnight + open * HOUR_IN_MS
      const state = getNyMarketSession(new Date(opensAt))
      assert.equal(state.isHoliday, false, date)
      assert.equal(state.isWeekday, true, date)
      assert.equal(state.isWeekend, false, date)
      assert.equal(state[name].isOpen, true, `${date} ${name}`)
      assert.equal(state[name].last.opensAt, opensAt, `${date} ${name}`)
      assert.equal(state[name].next.opensAt,
        Date.parse(`${next}T00:00:00${offset}`) + open * HOUR_IN_MS, `${date} ${name}`)
      assert.equal(previousState[name].next.opensAt, opensAt, `${date} ${name}`)
      assert.equal(nextState[name].last.opensAt, opensAt, `${date} ${name}`)
    }
  }
})

test('Saturday New Year does not close Friday; Sunday New Year closes Monday', () => {
  const friday = sessionAt('2027-12-31T12:00:00-05:00')
  assert.equal(friday.isHoliday, false)
  assert.equal(friday.regularMarket.isOpen, true)
  assert.equal(friday.regularMarket.next.opensAt, Date.parse('2028-01-03T09:30:00-05:00'))
  assertClosedOccurrences('2028-01-01T12:00:00-05:00', '2027-12-31T00:00:00-05:00', '2028-01-03T00:00:00-05:00', false)
  assertClosedOccurrences('2023-01-02T12:00:00-05:00', '2022-12-30T00:00:00-05:00', '2023-01-03T00:00:00-05:00')
})

test('early-close days and bank-only holidays remain non-holidays', () => {
  for (const date of ['2026-10-12', '2026-11-11', '2026-11-27', '2026-12-24']) {
    const state = sessionAt(`${date}T12:00:00-05:00`)
    assert.equal(state.isHoliday, false, date)
    assert.equal(state.regularMarket.isOpen, true, date)
  }
})

test('holiday classification changes at New York midnight, including milliseconds', () => {
  for (const [start, end] of [
    ['2026-12-25T05:00:00Z', '2026-12-26T05:00:00Z'],
    ['2027-06-18T04:00:00Z', '2027-06-19T04:00:00Z'],
  ]) {
    assert.equal(getNyMarketSession(new Date(Date.parse(start) - 1)).isHoliday, false)
    assert.equal(sessionAt(start).isHoliday, true)
    assert.equal(getNyMarketSession(new Date(Date.parse(end) - 1)).isHoliday, true)
    assert.equal(sessionAt(end).isHoliday, false)
  }
})

test('DST transitions preserve independently resolved last/next timestamps and isDST', () => {
  for (const [instant, previous, next, isDST] of [
    ['2027-03-14T06:59:59.999Z', '2027-03-12T00:00:00-05:00', '2027-03-15T00:00:00-04:00', false],
    ['2027-03-14T07:00:00Z', '2027-03-12T00:00:00-05:00', '2027-03-15T00:00:00-04:00', true],
    ['2026-11-01T05:59:59.999Z', '2026-10-30T00:00:00-04:00', '2026-11-02T00:00:00-05:00', true],
    ['2026-11-01T06:00:00Z', '2026-10-30T00:00:00-04:00', '2026-11-02T00:00:00-05:00', false],
  ]) {
    assert.equal(assertClosedOccurrences(instant, previous, next, false).isDST, isDST)
  }
})

test('each window retains its own last/next semantics at the opening instant', () => {
  const midnight = Date.parse('2027-01-19T00:00:00-05:00')
  for (const [name, [open, close]] of Object.entries(windows)) {
    const opensAt = midnight + open * HOUR_IN_MS
    const before = getNyMarketSession(new Date(opensAt - 1))[name]
    assert.equal(before.isOpen, false, name)
    assert.equal(before.next.opensAt, opensAt, name)
    assert.equal(before.next.timeToOpen, 1, name)
    assert.equal(before.last.opensAt, Date.parse('2027-01-15T00:00:00-05:00') + open * HOUR_IN_MS, name)
    const atOpen = getNyMarketSession(new Date(opensAt))[name]
    assert.equal(atOpen.isOpen, true, name)
    assert.equal(atOpen.last.opensAt, opensAt, name)
    assert.equal(atOpen.next.opensAt, midnight + DAY_IN_MS + open * HOUR_IN_MS, name)
    assert.equal(getNyMarketSession(new Date(midnight + close * HOUR_IN_MS))[name].isOpen, false, name)
  }
})

test('rolling coverage includes yesterday through day 365 and occurrences beyond its edges', () => {
  // Freeze the coverage reference so this regression is deterministic.
  const today = Date.UTC(2026, 10, 26)
  const expected = new Set(Object.entries(holidays).flatMap(([year, dates]) => dates.map(date => `${year}-${date}`)))
  for (let offset = -1; offset <= 365; offset++) {
    const date = new Date(today + offset * DAY_IN_MS).toISOString().slice(0, 10)
    const state = sessionAt(`${date}T12:00:00-05:00`)
    assert.equal(state.isHoliday, expected.has(date), date)
    for (const name of Object.keys(windows)) {
      for (const occurrence of [state[name].last, state[name].next]) {
        const opening = getNyMarketSession(new Date(occurrence.opensAt))
        assert.equal(opening.isHoliday, false, date)
        assert.equal(opening.isWeekend, false, date)
        assert.equal(opening[name].isOpen, true, date)
      }
    }
  }
  const start = sessionAt('2026-11-25T03:00:00-05:00')
  assert.equal(start.market.last.opensAt, Date.parse('2026-11-24T04:00:00-05:00'))
  const end = sessionAt('2027-11-26T21:00:00-05:00')
  assert.equal(end.market.next.opensAt, Date.parse('2027-11-29T04:00:00-05:00'))
})

test('Node and GAS client helpers expose the holiday calendar synchronously without HTTP', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2027-01-18T15:00:00Z') })
  for (const Client of [NodeClient, GasClient]) {
    const client = new Client({ API_KEY: 'dummy-key', API_SECRET: 'dummy-secret' })
    const state = client.getNyMarketSession()
    assert.equal(state instanceof Promise, false)
    assert.equal(state.isHoliday, true)
    assert.equal(state.session, 'closed')
    for (const name of Object.keys(windows)) assert.equal(state[name].isOpen, false)
  }
})

test('invalid Date inputs still fail immediately', () => {
  for (const value of [null, '2026-12-25', 0, {}, new Date(NaN)]) {
    assert.throws(() => getNyMarketSession(value), { name: 'TypeError', message: 'date must be a valid Date object.' })
  }
})

test('searching past the JavaScript Date limit throws instead of looping indefinitely', () => {
  assert.throws(() => getNyMarketSession(new Date(8640000000000000)), RangeError)
})
