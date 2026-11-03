// Canonical serialisation of sim state (R-CANON-*). Must produce byte-identical
// output to src/Sim/Canonical.php for every value both accept.

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function str(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDFFF) {
      const next = s.charCodeAt(i + 1);
      if (c > 0xDBFF || !(next >= 0xDC00 && next <= 0xDFFF)) throw new TypeError('canon: lone surrogate');
      out += s[i] + s[i + 1]; i++; continue;
    }
    if (c === 0x22) out += '\\"';
    else if (c === 0x5C) out += '\\\\';
    else if (c < 0x20) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += s[i];
  }
  return out + '"';
}

export function canonical(v) {
  if (v === null) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new TypeError(`canon: non-integer number ${v}`);
    return String(v === 0 ? 0 : v); // -0 -> "0"
  }
  if (typeof v === 'string') return str(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 0) throw new TypeError('canon: empty object (forbidden by R-CANON-4)');
    for (const k of keys) if (!KEY_RE.test(k)) throw new TypeError(`canon: bad key ${k}`);
    keys.sort(); // ASCII-only keys: UTF-16 order == byte order
    return '{' + keys.map((k) => str(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  throw new TypeError(`canon: unsupported type ${typeof v}`);
}

export function canonicalBytes(v) { return new TextEncoder().encode(canonical(v)); }
