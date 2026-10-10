/**
 * writing/toml — a pure TOML codec: `decodeToml` reads a TOML document into a
 * plain value tree, `encodeToml` writes one back out.
 *
 * A substrate primitive any package downstream reuses rather than hand-rolling a
 * parser. Pure string ↔ value functions, no I/O. Scope: the round-tripping 95% —
 * scalars (basic/literal/triple strings, ints with _ and 0x/0o/0b, floats,
 * inf/nan, booleans), bare/quoted/dotted keys, tables, arrays of tables, arrays,
 * inline tables, comments. Out of scope: datetimes (kept as strings) and comment
 * preservation — the codec models the data, not the formatting.
 */

/** A decoded TOML value. */
export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
/** A decoded TOML table. */
export interface TomlTable { [key: string]: TomlValue; }

interface Scan { readonly s: string; i: number; }

const isBareKeyChar = (c: string): boolean => /[A-Za-z0-9_-]/.test(c);

function skipInline(st: Scan): void {
  while (st.i < st.s.length && (st.s[st.i] === " " || st.s[st.i] === "\t")) st.i++;
}

function skipFiller(st: Scan): void {
  for (;;) {
    const c = st.s[st.i];
    if (c === " " || c === "\t" || c === "\n" || c === "," || c === "\r") { st.i++; continue; }
    if (c === "#") { while (st.i < st.s.length && st.s[st.i] !== "\n") st.i++; continue; }
    break;
  }
}

function endOfLine(st: Scan): void {
  skipInline(st);
  if (st.s[st.i] === "#") while (st.i < st.s.length && st.s[st.i] !== "\n") st.i++;
}

function parseString(st: Scan, quote: '"' | "'"): string {
  const triple = st.s.startsWith(quote.repeat(3), st.i);
  const literal = quote === "'";
  st.i += triple ? 3 : 1;
  if (triple && st.s[st.i] === "\n") st.i++;
  let out = "";
  for (;;) {
    if (st.i >= st.s.length) throw new SyntaxError("toml: unterminated string");
    if (st.s.startsWith(triple ? quote.repeat(3) : quote, st.i)) {
      st.i += triple ? 3 : 1;
      return out;
    }
    const c = st.s[st.i]!;
    if (!literal && c === "\\") {
      const next = st.s[st.i + 1]!;
      st.i += 2;
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === "r") out += "\r";
      else if (next === '"') out += '"';
      else if (next === "\\") out += "\\";
      else if (next === "u" || next === "U") {
        const len = next === "u" ? 4 : 8;
        const hex = st.s.slice(st.i, st.i + len);
        st.i += len;
        out += String.fromCodePoint(parseInt(hex, 16));
      } else if (next === "\n") {
        while (st.i < st.s.length && /\s/.test(st.s[st.i]!)) st.i++;
      } else out += next;
      continue;
    }
    out += c;
    st.i++;
  }
}

function classifyAtom(token: string): TomlValue {
  if (token === "true") return true;
  if (token === "false") return false;
  if (token === "inf" || token === "+inf") return Infinity;
  if (token === "-inf") return -Infinity;
  if (token === "nan" || token === "+nan" || token === "-nan") return NaN;
  const cleaned = token.replace(/_/g, "");
  if (/^[+-]?0x[0-9a-fA-F]+$/.test(cleaned)) return parseInt(cleaned, 16);
  if (/^[+-]?0o[0-7]+$/.test(cleaned)) return parseInt(cleaned.replace(/0o/, ""), 8);
  if (/^[+-]?0b[01]+$/.test(cleaned)) return parseInt(cleaned.replace(/0b/, ""), 2);
  if (/^[+-]?\d+$/.test(cleaned)) return Number(cleaned);
  if (/^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(cleaned)) return Number(cleaned);
  return token;
}

function parseValue(st: Scan): TomlValue {
  skipInline(st);
  const c = st.s[st.i];
  if (c === '"' || c === "'") return parseString(st, c);
  if (c === "[") return parseArray(st);
  if (c === "{") return parseInlineTable(st);
  let token = "";
  while (st.i < st.s.length && !/[\s,\]}#]/.test(st.s[st.i]!)) { token += st.s[st.i]!; st.i++; }
  if (token === "") throw new SyntaxError(`toml: expected a value at offset ${st.i}`);
  return classifyAtom(token);
}

function parseArray(st: Scan): TomlValue[] {
  st.i++;
  const out: TomlValue[] = [];
  for (;;) {
    skipFiller(st);
    if (st.s[st.i] === "]") { st.i++; return out; }
    if (st.i >= st.s.length) throw new SyntaxError("toml: unterminated array");
    out.push(parseValue(st));
  }
}

function parseInlineTable(st: Scan): TomlTable {
  st.i++;
  const out: TomlTable = {};
  for (;;) {
    skipFiller(st);
    if (st.s[st.i] === "}") { st.i++; return out; }
    if (st.i >= st.s.length) throw new SyntaxError("toml: unterminated inline table");
    const keys = parseKeyPath(st);
    skipInline(st);
    if (st.s[st.i] !== "=") throw new SyntaxError("toml: expected '=' in inline table");
    st.i++;
    assignDotted(out, keys, parseValue(st));
  }
}

function parseKeyPath(st: Scan): string[] {
  const keys: string[] = [];
  for (;;) {
    skipInline(st);
    const c = st.s[st.i];
    if (c === '"' || c === "'") keys.push(parseString(st, c));
    else {
      let bare = "";
      while (st.i < st.s.length && isBareKeyChar(st.s[st.i]!)) { bare += st.s[st.i]!; st.i++; }
      if (bare === "") throw new SyntaxError(`toml: expected a key at offset ${st.i}`);
      keys.push(bare);
    }
    skipInline(st);
    if (st.s[st.i] === ".") { st.i++; continue; }
    return keys;
  }
}

function asTable(value: TomlValue | undefined, where: string): TomlTable {
  if (value === undefined) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  throw new SyntaxError(`toml: ${where} redefines a non-table`);
}

function lastArrayTable(values: readonly TomlValue[], where: string): TomlTable {
  const value = values[values.length - 1];
  if (value === undefined) throw new SyntaxError(`toml: ${where} has no table entries`);
  return asTable(value, where);
}

function asArray(value: TomlValue | undefined, where: string): TomlValue[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  throw new SyntaxError(`toml: ${where} redefines a non-array`);
}

function assignDotted(root: TomlTable, keys: readonly string[], value: TomlValue): void {
  let node = root;
  for (let k = 0; k < keys.length - 1; k++) {
    const key = keys[k]!;
    const table = asTable(node[key], `key ${keys.join(".")}`);
    node[key] = table;
    node = table;
  }
  node[keys[keys.length - 1]!] = value;
}

function ensureTable(root: TomlTable, keys: readonly string[]): TomlTable {
  let node = root;
  for (const key of keys) {
    const existing = node[key];
    if (Array.isArray(existing)) node = lastArrayTable(existing, `table [${keys.join(".")}]`);
    else {
      const table = asTable(existing, `table [${keys.join(".")}]`);
      node[key] = table;
      node = table;
    }
  }
  return node;
}

function pushArrayTable(root: TomlTable, keys: readonly string[]): TomlTable {
  let node = root;
  for (let k = 0; k < keys.length - 1; k++) {
    const key = keys[k]!;
    const existing = node[key];
    if (Array.isArray(existing)) node = lastArrayTable(existing, `array-table [[${keys.join(".")}]]`);
    else {
      const table = asTable(existing, `array-table [[${keys.join(".")}]]`);
      node[key] = table;
      node = table;
    }
  }
  const leaf = keys[keys.length - 1]!;
  const arr = asArray(node[leaf], `array-table [[${keys.join(".")}]]`);
  node[leaf] = arr;
  const fresh: TomlTable = {};
  arr.push(fresh);
  return fresh;
}

/** Decode a TOML document into a plain value tree. */
export function decodeToml(text: string): TomlTable {
  const st: Scan = { s: text.replace(/^﻿/, "").replace(/\r\n/g, "\n"), i: 0 };
  const root: TomlTable = {};
  let current = root;
  for (;;) {
    skipFiller(st);
    if (st.i >= st.s.length) break;
    if (st.s[st.i] === "[") {
      const arrayTable = st.s[st.i + 1] === "[";
      st.i += arrayTable ? 2 : 1;
      const keys = parseKeyPath(st);
      skipInline(st);
      const close = arrayTable ? "]]" : "]";
      if (!st.s.startsWith(close, st.i)) throw new SyntaxError(`toml: expected '${close}'`);
      st.i += close.length;
      current = arrayTable ? pushArrayTable(root, keys) : ensureTable(root, keys);
      endOfLine(st);
    } else {
      const keys = parseKeyPath(st);
      skipInline(st);
      if (st.s[st.i] !== "=") throw new SyntaxError(`toml: expected '=' after key ${keys.join(".")}`);
      st.i++;
      assignDotted(current, keys, parseValue(st));
      endOfLine(st);
    }
  }
  return root;
}

const isBareKey = (key: string): boolean => /^[A-Za-z0-9_-]+$/.test(key);
const encodeKey = (key: string): string => (isBareKey(key) ? key : encodeString(key));

function encodeString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

function encodeScalar(value: Exclude<TomlValue, TomlTable | TomlValue[]>): string {
  if (typeof value === "string") return encodeString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === Infinity) return "inf";
  if (value === -Infinity) return "-inf";
  if (Number.isNaN(value)) return "nan";
  return String(value);
}

const isPlainTable = (v: TomlValue): v is TomlTable => typeof v === "object" && !Array.isArray(v);
const isArrayOfTables = (v: TomlValue): v is TomlTable[] => Array.isArray(v) && v.length > 0 && v.every(isPlainTable);

function encodeInline(value: TomlValue): string {
  if (isPlainTable(value)) {
    const parts = Object.entries(value).map(([k, v]) => `${encodeKey(k)} = ${encodeInline(v)}`);
    return `{ ${parts.join(", ")} }`;
  }
  if (Array.isArray(value)) return `[${value.map(encodeInline).join(", ")}]`;
  return encodeScalar(value);
}

function emitTable(prefix: readonly string[], table: TomlTable, out: string[]): void {
  const scalars: string[] = [];
  const subTables: Array<[string, TomlTable]> = [];
  const arrayTables: Array<[string, TomlTable[]]> = [];
  for (const [key, value] of Object.entries(table)) {
    if (isArrayOfTables(value)) arrayTables.push([key, value]);
    else if (isPlainTable(value)) subTables.push([key, value]);
    else scalars.push(`${encodeKey(key)} = ${encodeInline(value)}`);
  }
  if (prefix.length > 0 && (scalars.length > 0 || (subTables.length === 0 && arrayTables.length === 0))) {
    out.push(`[${prefix.map(encodeKey).join(".")}]`);
  }
  for (const line of scalars) out.push(line);
  if (scalars.length > 0) out.push("");
  for (const [key, child] of subTables) emitTable([...prefix, key], child, out);
  for (const [key, elements] of arrayTables) {
    for (const element of elements) {
      out.push(`[[${[...prefix, key].map(encodeKey).join(".")}]]`);
      const body: string[] = [];
      emitTableBody(element, body);
      for (const line of body) out.push(line);
      out.push("");
    }
  }
}

function emitTableBody(table: TomlTable, out: string[]): void {
  for (const [key, value] of Object.entries(table)) {
    if (!isPlainTable(value) && !isArrayOfTables(value)) out.push(`${encodeKey(key)} = ${encodeInline(value)}`);
  }
  for (const [key, value] of Object.entries(table)) {
    if (isPlainTable(value)) emitTable([key], value, out);
  }
}

/** Encode a value tree into a TOML document. */
export function encodeToml(table: TomlTable): string {
  const out: string[] = [];
  emitTable([], table, out);
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}
