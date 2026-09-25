const MAX_SCRIPT_KEY_LENGTH = 250
const MAX_SCRIPT_VALUE_BYTES = 100 * 1024
const MAX_SCRIPT_TTL_SECONDS = 21600

function utf8Length(value) {
  return encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, 'x').length
}

function keyFingerprint(value) {
  let first = 2166136261
  let second = 2166136261 ^ 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 16777619)
    second = Math.imul(second ^ code, 2246822519)
  }
  return (first >>> 0).toString(16).padStart(8, '0') +
    (second >>> 0).toString(16).padStart(8, '0')
}

/** Small, best-effort cache for public Binance metadata. */
export default class MetadataCache {
  constructor({ now = Date.now, baseUrl = 'https://api.binance.com' } = {}) {
    if (typeof now !== 'function') throw new TypeError('now must be a function.')
    if (typeof baseUrl !== 'string' || !/^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/?$/.test(baseUrl)) {
      throw new TypeError('baseUrl must be an HTTPS origin without credentials or a path.')
    }
    this._now = now
    this._baseUrl = baseUrl.replace(/\/$/, '')
    this._entries = new Map()
    this._scriptCache = null
    if (globalThis.UrlFetchApp && globalThis.CacheService?.getScriptCache) {
      try { this._scriptCache = globalThis.CacheService.getScriptCache() } catch { /* Fall back to local storage. */ }
    }
  }

  _scriptKey(key) {
    const full = `simple-binance-stocks:metadata:v1:${this._baseUrl}:${key}`
    if (full.length <= MAX_SCRIPT_KEY_LENGTH) return full
    const fingerprint = keyFingerprint(full)
    return `${full.slice(0, MAX_SCRIPT_KEY_LENGTH - fingerprint.length - 1)}~${fingerprint}`
  }

  get(key) {
    if (typeof key !== 'string' || key.length === 0) return undefined
    let serialized
    if (this._scriptCache) {
      try { serialized = this._scriptCache.get(this._scriptKey(key)) } catch { return undefined }
    } else {
      const entry = this._entries.get(key)
      if (!entry) return undefined
      if (this._now() >= entry.expiresAt) {
        this._entries.delete(key)
        return undefined
      }
      serialized = entry.serialized
    }
    if (serialized == null) return undefined
    try { return JSON.parse(serialized) } catch {
      this.delete(key)
      return undefined
    }
  }

  set(key, value, ttlSeconds) {
    if (typeof key !== 'string' || key.length === 0) return
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      this.delete(key)
      return
    }
    let serialized
    try { serialized = JSON.stringify(value) } catch { return }
    if (serialized === undefined) return
    const lifetime = Math.min(MAX_SCRIPT_TTL_SECONDS, Math.max(1, Math.floor(ttlSeconds)))
    if (this._scriptCache) {
      if (utf8Length(serialized) > MAX_SCRIPT_VALUE_BYTES) {
        this.delete(key)
        return
      }
      try { this._scriptCache.put(this._scriptKey(key), serialized, lifetime) } catch { /* Cache failures do not affect requests. */ }
    } else {
      const expiresAt = this._now() + lifetime * 1000
      if (Number.isFinite(expiresAt)) this._entries.set(key, { serialized, expiresAt })
    }
  }

  delete(key) {
    if (typeof key !== 'string' || key.length === 0) return
    if (this._scriptCache) {
      try { this._scriptCache.remove(this._scriptKey(key)) } catch { /* Cache failures do not affect requests. */ }
    } else {
      this._entries.delete(key)
    }
  }
}
