const assert = require("node:assert/strict");
const test = require("node:test");
const { parseFamilyNames, parseRegistryFontPaths } = require("../electron/fonts.cjs");

function encodeName(text) {
  const bytes = Buffer.alloc(text.length * 2);
  for (let i = 0; i < text.length; i++) bytes.writeUInt16BE(text.charCodeAt(i), i * 2);
  return bytes;
}

function makeNameTable(names) {
  const records = names.map(({ nameId, text }) => ({
    nameId,
    bytes: encodeName(text),
  }));
  const stringOffset = 6 + records.length * 12;
  const table = Buffer.alloc(
    stringOffset + records.reduce((sum, record) => sum + record.bytes.length, 0),
  );
  table.writeUInt16BE(0, 0);
  table.writeUInt16BE(records.length, 2);
  table.writeUInt16BE(stringOffset, 4);
  let stringPosition = 0;
  records.forEach((record, index) => {
    const offset = 6 + index * 12;
    table.writeUInt16BE(3, offset);
    table.writeUInt16BE(1, offset + 2);
    table.writeUInt16BE(0x0409, offset + 4);
    table.writeUInt16BE(record.nameId, offset + 6);
    table.writeUInt16BE(record.bytes.length, offset + 8);
    table.writeUInt16BE(stringPosition, offset + 10);
    record.bytes.copy(table, stringOffset + stringPosition);
    stringPosition += record.bytes.length;
  });
  return table;
}

test("prefers a typographic family name over a style-specific legacy name", () => {
  const table = makeNameTable([
    { nameId: 1, text: "Cutline Sans Bold" },
    { nameId: 16, text: "Cutline Sans" },
  ]);
  assert.deepEqual(parseFamilyNames(table), ["Cutline Sans"]);
});

test("falls back to a legacy family name when a typographic name is absent", () => {
  const table = makeNameTable([{ nameId: 1, text: "Legacy Family" }]);
  assert.deepEqual(parseFamilyNames(table), ["Legacy Family"]);
});

test("ignores malformed OpenType name tables", () => {
  const table = Buffer.alloc(6);
  table.writeUInt16BE(2, 2);
  assert.deepEqual(parseFamilyNames(table), []);
  assert.deepEqual(parseFamilyNames(Buffer.alloc(2)), []);
});

test("resolves system and per-user font registry entries", () => {
  const registry = [
    "HKEY_LOCAL_MACHINE\\SOFTWARE\\Fonts",
    "    Cutline Sans (TrueType)    REG_SZ    cutline-sans.ttf",
    "    User Family (OpenType)    REG_EXPAND_SZ    %LOCALAPPDATA%\\Microsoft\\Windows\\Fonts\\user.otf",
    "    Not a font    REG_SZ    settings.txt",
  ].join("\r\n");
  const paths = parseRegistryFontPaths(
    registry,
    "C:\\Windows\\Fonts",
    { LOCALAPPDATA: "C:\\Users\\Editor\\AppData\\Local" },
  );
  assert.deepEqual(paths, [
    "C:\\Windows\\Fonts\\cutline-sans.ttf",
    "C:\\Users\\Editor\\AppData\\Local\\Microsoft\\Windows\\Fonts\\user.otf",
  ]);
});
