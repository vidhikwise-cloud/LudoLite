/**
 * Json column codec.
 *
 * Production runs on Postgres, where these columns are native `Json`. The
 * automated test suite runs on SQLite, which has no Json type, so the test
 * schema declares them `String`.
 *
 * Writing a JSON *string* works on both: Postgres accepts a string as a valid
 * JSON scalar... which is not what we want, because then `detail` would come
 * back as a quoted blob rather than an object. So instead both sides agree on
 * one representation — a serialized string — and every read goes through
 * `fromDbJson`. One rule, no per-provider branching in business logic.
 */

export type DbJson = string;

/** Serialize a value for a Json/String column. */
export function toDbJson(value: unknown): DbJson {
  if (value === undefined) return '{}';
  try {
    return JSON.stringify(value) ?? '{}';
  } catch {
    // Circular or otherwise unserializable: never let a log line break a
    // request. Record that something was dropped instead.
    return JSON.stringify({ error: 'value was not serializable' });
  }
}

/** Parse a Json/String column back into a value. */
export function fromDbJson<T = unknown>(raw: unknown): T {
  if (raw === null || raw === undefined) return {} as T;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return {} as T;
    }
  }
  // Postgres native Json already comes back parsed.
  return raw as T;
}
