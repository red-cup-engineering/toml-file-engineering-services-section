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
export interface TomlTable {
    [key: string]: TomlValue;
}
/** Decode a TOML document into a plain value tree. */
export declare function decodeToml(text: string): TomlTable;
/** Encode a value tree into a TOML document. */
export declare function encodeToml(table: TomlTable): string;
//# sourceMappingURL=index.d.mts.map