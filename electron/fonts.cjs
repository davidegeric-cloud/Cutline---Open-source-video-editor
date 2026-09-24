const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const FONT_EXTENSIONS = new Set([".otc", ".otf", ".ttc", ".ttf"]);
const REGISTRY_KEYS = [
  ["HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts", "system"],
  ["HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts", "user"],
];
let fontListCache;

function parseRegistryFontPaths(output, fontDirectory, env = process.env) {
  const paths = [];
  for (const line of String(output).split(/\r?\n/)) {
    const match = line.match(/^\s*.+?\s+REG_(?:SZ|EXPAND_SZ|MULTI_SZ)\s+(.+?)\s*$/i);
    if (!match) continue;
    const value = match[1]
      .trim()
      .replace(/^"|"$/g, "")
      .replace(/%([^%]+)%/g, (token, name) => env[name] ?? token);
    if (!FONT_EXTENSIONS.has(path.win32.extname(value).toLowerCase())) continue;
    paths.push(
      path.win32.isAbsolute(value) ? value : path.win32.join(fontDirectory, value),
    );
  }
  return [...new Set(paths)];
}

function decodeName(bytes, platformId) {
  if (platformId === 0 || platformId === 3) {
    if (bytes.length % 2 !== 0) return "";
    const littleEndian = Buffer.from(bytes);
    littleEndian.swap16();
    return littleEndian.toString("utf16le").replace(/\0/g, "").trim();
  }
  return "";
}

function parseFamilyNames(nameTable) {
  if (!Buffer.isBuffer(nameTable) || nameTable.length < 6) return [];
  const count = nameTable.readUInt16BE(2);
  const stringsOffset = nameTable.readUInt16BE(4);
  if (count > 2048 || 6 + count * 12 > nameTable.length) return [];
  const candidates = new Map([[1, []], [16, []]]);
  for (let i = 0; i < count; i++) {
    const record = 6 + i * 12;
    const platform = nameTable.readUInt16BE(record);
    if (platform !== 0 && platform !== 3) continue;
    const nameId = nameTable.readUInt16BE(record + 6);
    if (nameId !== 1 && nameId !== 16) continue;
    const length = nameTable.readUInt16BE(record + 8);
    const offset = nameTable.readUInt16BE(record + 10);
    const start = stringsOffset + offset;
    if (!length || start + length > nameTable.length) continue;
    const family = decodeName(nameTable.subarray(start, start + length), platform)
      .split("")
      .filter((character) => character.charCodeAt(0) >= 0x20)
      .join("")
      .trim();
    if (!family) continue;
    const language = nameTable.readUInt16BE(record + 4);
    const score =
      (platform === 3 && language === 0x0409 ? 3 : 0) +
      (platform === 0 ? 2 : 0) +
      (platform === 3 && language === 0 ? 1 : 0);
    candidates.get(nameId).push({ family, score });
  }
  const preferred = candidates.get(16);
  const selected = preferred.length ? preferred : candidates.get(1);
  selected.sort((a, b) => b.score - a.score);
  return selected.length ? [selected[0].family] : [];
}

async function readAt(handle, position, length) {
  const bytes = Buffer.alloc(length);
  const { bytesRead } = await handle.read(bytes, 0, length, position);
  return bytes.subarray(0, bytesRead);
}

async function readFontFamilies(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (stat.size < 12 || stat.size > 64 * 1024 * 1024) return [];
    const header = await readAt(handle, 0, 12);
    const isCollection = header.toString("ascii", 0, 4) === "ttcf";
    let faceOffsets = [0];
    if (isCollection) {
      const faceCount = header.readUInt32BE(8);
      if (!faceCount || faceCount > 256) return [];
      const offsets = await readAt(handle, 12, faceCount * 4);
      if (offsets.length !== faceCount * 4) return [];
      faceOffsets = Array.from({ length: faceCount }, (_, i) =>
        offsets.readUInt32BE(i * 4),
      );
    } else if (!["\u0000\u0001\u0000\u0000", "OTTO", "true", "typ1"].includes(header.toString("latin1", 0, 4))) {
      return [];
    }

    const families = new Set();
    for (const faceOffset of faceOffsets) {
      const faceHeader = await readAt(handle, faceOffset, 12);
      if (faceHeader.length !== 12) continue;
      const tableCount = faceHeader.readUInt16BE(4);
      if (!tableCount || tableCount > 4096) continue;
      const directory = await readAt(handle, faceOffset + 12, tableCount * 16);
      if (directory.length !== tableCount * 16) continue;
      let nameTableOffset = -1;
      let nameTableLength = 0;
      for (let i = 0; i < tableCount; i++) {
        const record = i * 16;
        if (directory.toString("ascii", record, record + 4) !== "name") continue;
        nameTableOffset = directory.readUInt32BE(record + 8);
        nameTableLength = directory.readUInt32BE(record + 12);
        break;
      }
      if (
        nameTableOffset < 0 ||
        !nameTableLength ||
        nameTableLength > 4 * 1024 * 1024 ||
        nameTableOffset + nameTableLength > stat.size
      ) continue;
      const familiesInFace = parseFamilyNames(
        await readAt(handle, nameTableOffset, nameTableLength),
      );
      for (const family of familiesInFace) families.add(family);
    }
    return [...families];
  } finally {
    await handle.close();
  }
}

function queryRegistry(key) {
  return new Promise((resolve) => {
    execFile(
      "reg.exe",
      ["query", key],
      { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 2 * 1024 * 1024 },
      (_error, stdout) => resolve(stdout ?? ""),
    );
  });
}

async function existingFontFiles(paths) {
  const files = [];
  for (let i = 0; i < paths.length; i += 16) {
    const batch = await Promise.all(
      paths.slice(i, i + 16).map(async (filePath) => {
        if (!FONT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return null;
        try {
          return (await fs.stat(filePath)).isFile() ? filePath : null;
        } catch {
          return null;
        }
      }),
    );
    files.push(...batch.filter(Boolean));
  }
  return [...new Set(files)];
}

async function fontFilesIn(directory) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isFile() && FONT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
      )
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

async function scanInstalledFonts() {
  if (process.platform !== "win32") return [];
  const windowsDir = process.env.WINDIR || "C:\\Windows";
  const windowsFonts = path.win32.join(windowsDir, "Fonts");
  const userFonts = path.win32.join(
    process.env.LOCALAPPDATA || "",
    "Microsoft",
    "Windows",
    "Fonts",
  );
  const registered = [];
  for (const [key, owner] of REGISTRY_KEYS) {
    const directory = owner === "user" ? userFonts : windowsFonts;
    registered.push(
      ...parseRegistryFontPaths(await queryRegistry(key), directory),
    );
  }
  const files = await existingFontFiles([
    ...registered,
    ...(await fontFilesIn(windowsFonts)),
    ...(await fontFilesIn(userFonts)),
  ]);
  const families = new Set();
  for (let i = 0; i < files.length; i += 12) {
    const batch = await Promise.all(
      files.slice(i, i + 12).map((filePath) =>
        readFontFamilies(filePath).catch(() => []),
      ),
    );
    for (const familyNames of batch) {
      for (const family of familyNames) families.add(family);
    }
  }
  return [...families].sort((a, b) => a.localeCompare(b));
}

function listInstalledFonts(refresh = false) {
  if (!fontListCache || refresh) {
    fontListCache = scanInstalledFonts().catch(() => []);
  }
  return fontListCache;
}

module.exports = {
  listInstalledFonts,
  parseFamilyNames,
  parseRegistryFontPaths,
  readFontFamilies,
};
