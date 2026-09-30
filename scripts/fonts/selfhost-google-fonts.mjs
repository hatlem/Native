#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";

const GOOGLE_SPECIFIERS = new Set([["next", "font", "google"].join("/"), ["@next", "font", "google"].join("/")]);
const LOCAL_SPECIFIER = "next/font/local";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36";
const TEXT_PARAM_LIMIT = 800;
const DEFAULT_EXTRA_SUBSETS = ["latin-ext"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const JSX_EXTENSIONS = new Set([".tsx", ".jsx"]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".turbo", ".vercel", ".expo", "dist", "build", "out", "coverage"]);
const CARRIED_OPTIONS = new Set(["variable", "display", "preload", "fallback"]);
const CONSUMED_OPTIONS = new Set(["subsets", "weight", "style", "axes", "adjustFontFallback"]);
const SELF = realpathSync(fileURLToPath(import.meta.url));

class ToolError extends Error {}

function fail(message) {
  throw new ToolError(message);
}

function parseArgs(argv) {
  const args = { root: process.cwd(), check: false, fontsDir: undefined, module: undefined, extraSubsets: DEFAULT_EXTRA_SUBSETS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i] ?? fail(`Missing value for ${arg}`);
    if (arg === "--check") args.check = true;
    else if (arg === "--root") args.root = value();
    else if (arg === "--fonts-dir") args.fontsDir = value();
    else if (arg === "--module") args.module = value();
    else if (arg === "--extra-subsets") args.extraSubsets = value().split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else fail(`Unknown argument: ${arg}`);
  }
  args.root = path.resolve(args.root);
  return args;
}

const HELP = `Usage: node scripts/fonts/selfhost-google-fonts.mjs [--root <next-app-dir>] [--fonts-dir <dir>] [--module <file>] [--check]

Replaces every Google font loader import with self-hosted next/font/local fonts.
  --root       Next.js app root (default: cwd). typescript and next are resolved from here.
  --fonts-dir  Where .woff2 + license files go (default: <root>/src/fonts, or <root>/fonts without src/).
  --module     Module that receives definitions moved out of .tsx/.jsx files (default: <fonts-dir>/index.ts).
  --extra-subsets  Comma-separated subsets bundled in addition to latin and the call's own subsets (default: latin-ext; "" for none).
  --check      Exit 1 if any Google font loader import remains; changes nothing.`;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) walk(path.join(dir, entry.name), out);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      const full = path.join(dir, entry.name);
      if (realpathSync(full) !== SELF) out.push(full);
    }
  }
  return out;
}

function googleReferencePattern() {
  const alternatives = [...GOOGLE_SPECIFIERS].map((s) => s.replace(/[/@]/g, (c) => `\\${c}`)).join("|");
  return new RegExp(`(["'\`])(?:${alternatives})\\1`);
}

function findCandidateFiles(root) {
  const pattern = googleReferencePattern();
  return walk(root).filter((file) => pattern.test(readFileSync(file, "utf8")));
}

function loadToolchain(root) {
  const packageJson = path.join(root, "package.json");
  if (!existsSync(packageJson)) fail(`No package.json in ${root}; pass --root <next-app-dir>`);
  const require = createRequire(packageJson);
  const load = (id) => {
    try {
      return require(id);
    } catch (error) {
      fail(`Cannot load ${id} from ${root} (${error.code ?? error.message}). Install dependencies first.`);
    }
  };
  const googleDir = "next/dist/compiled/@next/font/dist/google";
  return {
    ts: load("typescript"),
    nextVersion: load("next/package.json").version,
    validateGoogleFontFunctionCall: load(`${googleDir}/validate-google-font-function-call`).validateGoogleFontFunctionCall,
    getFontAxes: load(`${googleDir}/get-font-axes`).getFontAxes,
    getGoogleFontsUrl: load(`${googleDir}/get-google-fonts-url`).getGoogleFontsUrl,
    calculateSizeAdjustValues: load("next/dist/server/font-utils").calculateSizeAdjustValues,
  };
}

function scriptKind(ts, file) {
  const ext = path.extname(file);
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function location(sourceFile, node, root) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${path.relative(root, sourceFile.fileName)}:${line + 1}:${character + 1}`;
}

function unwrap(ts, node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    (ts.isSatisfiesExpression && ts.isSatisfiesExpression(current)) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function evaluateLiteral(ts, node, where) {
  const value = unwrap(ts, node);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (ts.isNumericLiteral(value)) return Number(value.text);
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(value)) return value.elements.map((element) => evaluateLiteral(ts, element, where));
  fail(`${where}: font option value \`${value.getText()}\` is not a literal; convert this call by hand`);
}

function propertyName(ts, name, where) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  fail(`${where}: unsupported property name \`${name.getText()}\``);
}

function parseOptions(ts, call, where) {
  if (call.arguments.length === 0) return { options: {}, properties: [], object: undefined };
  if (call.arguments.length > 1) fail(`${where}: expected a single options argument`);
  const object = unwrap(ts, call.arguments[0]);
  if (!ts.isObjectLiteralExpression(object)) fail(`${where}: font options must be an object literal`);
  const options = {};
  const properties = [];
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) fail(`${where}: unsupported option syntax \`${property.getText()}\``);
    const key = propertyName(ts, property.name, where);
    if (!CARRIED_OPTIONS.has(key) && !CONSUMED_OPTIONS.has(key)) fail(`${where}: unknown font option \`${key}\``);
    options[key] = evaluateLiteral(ts, property.initializer, where);
    properties.push({ key, text: property.getText(), node: property });
  }
  return { options, properties, object };
}

function analyzeFile(toolchain, root, file) {
  const { ts } = toolchain;
  const text = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(ts, file));
  const imports = [];
  const loaderNames = new Map();
  let localFontImport;

  const visitModuleReferences = (node) => {
    const specifierOf = (expr) => (expr && ts.isStringLiteralLike(expr) ? expr.text : undefined);
    if (ts.isImportDeclaration(node)) {
      const specifier = specifierOf(node.moduleSpecifier);
      if (GOOGLE_SPECIFIERS.has(specifier)) {
        const where = location(sourceFile, node, root);
        const clause = node.importClause;
        if (!clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings) || clause.isTypeOnly) {
          fail(`${where}: only \`import { Font } from "<google font loader>"\` is supported`);
        }
        for (const element of clause.namedBindings.elements) {
          if (element.isTypeOnly) continue;
          loaderNames.set(element.name.text, (element.propertyName ?? element.name).text);
        }
        imports.push(node);
      } else if (specifier === LOCAL_SPECIFIER && node.importClause?.name) {
        localFontImport = node.importClause.name.text;
      }
    } else if (ts.isExportDeclaration(node) && GOOGLE_SPECIFIERS.has(specifierOf(node.moduleSpecifier))) {
      fail(`${location(sourceFile, node, root)}: re-exporting the Google font loader is not supported`);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && GOOGLE_SPECIFIERS.has(specifierOf(node.arguments[0]))) {
      fail(`${location(sourceFile, node, root)}: require()/import() of the Google font loader is not supported`);
    }
    ts.forEachChild(node, visitModuleReferences);
  };
  visitModuleReferences(sourceFile);

  if (imports.length === 0) return undefined;
  if (imports.length > 1) fail(`${location(sourceFile, imports[1], root)}: multiple Google font loader imports in one file`);

  const calls = [];
  const visitUsages = (node) => {
    const isLoaderReference =
      ts.isIdentifier(node) &&
      loaderNames.has(node.text) &&
      !ts.isImportSpecifier(node.parent) &&
      !((ts.isPropertyAccessExpression(node.parent) || ts.isPropertyAssignment(node.parent) || ts.isPropertySignature(node.parent)) && node.parent.name === node);
    if (isLoaderReference) {
      const where = location(sourceFile, node, root);
      const call = node.parent;
      const declaration = call?.parent;
      const list = declaration?.parent;
      const statement = list?.parent;
      const valid =
        ts.isCallExpression(call) &&
        call.expression === node &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer === call &&
        ts.isIdentifier(declaration.name) &&
        ts.isVariableDeclarationList(list) &&
        list.declarations.length === 1 &&
        list.flags & ts.NodeFlags.Const &&
        ts.isVariableStatement(statement) &&
        statement.parent === sourceFile;
      if (!valid) fail(`${where}: \`${node.text}\` must be used as \`const x = ${node.text}({...})\` at module scope`);
      const { options, properties, object } = parseOptions(ts, call, where);
      calls.push({
        where,
        functionName: loaderNames.get(node.text),
        name: declaration.name.text,
        exported: Boolean(statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)),
        statement,
        call,
        object,
        options,
        properties,
      });
    }
    ts.forEachChild(node, visitUsages);
  };
  visitUsages(sourceFile);

  if (calls.length === 0 && loaderNames.size > 0) fail(`${location(sourceFile, imports[0], root)}: imported fonts are never called`);
  return { file, text, sourceFile, importNode: imports[0], localFontImport, calls };
}

const KNOWN_WOFF2_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
  "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
  "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
  "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

function readWoff2Tables(buffer, label) {
  if (buffer.subarray(0, 4).toString("latin1") !== "wOF2") fail(`${label}: not a woff2 file`);
  if (buffer.readUInt32BE(4) === 0x74746366) fail(`${label}: woff2 font collections are not supported`);
  const numTables = buffer.readUInt16BE(12);
  const totalCompressedSize = buffer.readUInt32BE(20);
  let offset = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = buffer[offset++];
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    fail(`${label}: malformed woff2 table directory`);
  };
  const directory = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buffer[offset++];
    const index = flags & 0x3f;
    let tag = KNOWN_WOFF2_TAGS[index];
    if (index === 63) {
      tag = buffer.subarray(offset, offset + 4).toString("latin1");
      offset += 4;
    }
    const version = flags >> 6;
    const originalLength = base128();
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    directory.push({ tag, length: transformed ? base128() : originalLength });
  }
  const data = brotliDecompressSync(buffer.subarray(offset, offset + totalCompressedSize));
  const tables = new Map();
  let cursor = 0;
  for (const { tag, length } of directory) {
    tables.set(tag, data.subarray(cursor, cursor + length));
    cursor += length;
  }
  return tables;
}

function cmapCodepoints(tables, label) {
  const cmap = tables.get("cmap") ?? fail(`${label}: font has no cmap table`);
  const codepoints = new Set();
  const count = cmap.readUInt16BE(2);
  for (let i = 0; i < count; i++) {
    const platform = cmap.readUInt16BE(4 + i * 8);
    const encoding = cmap.readUInt16BE(6 + i * 8);
    const offset = cmap.readUInt32BE(8 + i * 8);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const format = cmap.readUInt16BE(offset);
    if (format === 4) {
      const segCountX2 = cmap.readUInt16BE(offset + 6);
      const ends = offset + 14;
      const starts = ends + segCountX2 + 2;
      const deltas = starts + segCountX2;
      const rangeOffsets = deltas + segCountX2;
      for (let s = 0; s < segCountX2; s += 2) {
        const end = cmap.readUInt16BE(ends + s);
        const start = cmap.readUInt16BE(starts + s);
        const delta = cmap.readInt16BE(deltas + s);
        const rangeOffset = cmap.readUInt16BE(rangeOffsets + s);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let glyph;
          if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
          else {
            const raw = cmap.readUInt16BE(rangeOffsets + s + rangeOffset + (c - start) * 2);
            glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
          }
          if (glyph) codepoints.add(c);
        }
      }
    } else if (format === 12) {
      const groups = cmap.readUInt32BE(offset + 12);
      for (let g = 0; g < groups; g++) {
        const base = offset + 16 + g * 12;
        const start = cmap.readUInt32BE(base);
        const end = cmap.readUInt32BE(base + 4);
        const glyph = cmap.readUInt32BE(base + 8);
        for (let c = start; c <= end; c++) if (glyph + (c - start)) codepoints.add(c);
      }
    }
  }
  return codepoints;
}

function variationAxes(tables) {
  const fvar = tables.get("fvar");
  if (!fvar) return "";
  const axesOffset = fvar.readUInt16BE(4);
  const count = fvar.readUInt16BE(8);
  const size = fvar.readUInt16BE(10);
  const axes = [];
  for (let i = 0; i < count; i++) {
    const base = axesOffset + i * size;
    axes.push(`${fvar.subarray(base, base + 4).toString("latin1")}:${fvar.readInt32BE(base + 4) / 65536}..${fvar.readInt32BE(base + 12) / 65536}`);
  }
  return axes.join(" ");
}

function parseUnicodeRange(value) {
  const codepoints = new Set();
  for (const token of value.split(",")) {
    const [start, end] = token.trim().replace(/^U\+/i, "").split("-");
    const [lo, hi] = start.includes("?")
      ? [parseInt(start.replace(/\?/g, "0"), 16), parseInt(start.replace(/\?/g, "F"), 16)]
      : [parseInt(start, 16), parseInt(end ?? start, 16)];
    for (let c = lo; c <= hi; c++) codepoints.add(c);
  }
  return codepoints;
}

function parseFontFaces(css, label) {
  const faces = [];
  for (const [, subset, body] of css.matchAll(/(?:\/\*\s*(.+?)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g)) {
    const field = (name) => body.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
    const url = body.match(/src:\s*url\(([^)]+)\)/)?.[1];
    const style = field("font-style");
    const weight = field("font-weight");
    if (!url || !style || !weight) fail(`${label}: unexpected @font-face in Google Fonts CSS:\n${body}`);
    faces.push({ subset, url, style, weight, unicodeRange: field("unicode-range") });
  }
  if (faces.length === 0) fail(`${label}: Google Fonts returned no @font-face rules`);
  return faces;
}

const responseCache = new Map();

async function fetchBytes(url, label) {
  if (responseCache.has(url)) return responseCache.get(url);
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) });
      if (response.status === 404) {
        responseCache.set(url, null);
        return null;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      responseCache.set(url, bytes);
      return bytes;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  fail(`${label}: failed to fetch ${url} (${lastError.message})`);
}

async function fetchRequired(url, label) {
  return (await fetchBytes(url, label)) ?? fail(`${label}: 404 for ${url}`);
}

function subsetPriority(requested, extra) {
  return [...new Set(["latin", ...requested, ...extra])];
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function faceKey(face) {
  return `${face.style}|${face.weight}`;
}

async function resolveFont(toolchain, call, extraSubsets) {
  const label = `${call.where} (${call.functionName})`;
  let validated;
  try {
    validated = toolchain.validateGoogleFontFunctionCall(call.functionName, call.options);
  } catch (error) {
    fail(`${label}: ${error.message}`);
  }
  const { fontFamily } = validated;
  const axes = toolchain.getFontAxes(fontFamily, validated.weights, validated.styles, validated.selectedVariableAxes);
  const cssUrl = toolchain.getGoogleFontsUrl(fontFamily, axes, validated.display);
  const faces = parseFontFaces((await fetchRequired(cssUrl, label)).toString("utf8"), label);

  const sliced = faces.filter((face) => !face.subset || /^\[\d+\]$/.test(face.subset));
  if (sliced.length > 0) fail(`${label}: ${fontFamily} is served as ${sliced.length} numbered unicode-range slices (CJK); self-host it by hand`);

  const available = new Set(faces.map((face) => face.subset));
  const requested = validated.subsets ?? [];
  for (const subset of requested) if (!available.has(subset)) fail(`${label}: Google Fonts CSS has no \`${subset}\` subset for ${fontFamily}`);
  const wanted = subsetPriority(requested, extraSubsets);
  const priority = wanted.filter((subset) => available.has(subset));
  if (priority.length === 0) fail(`${label}: ${fontFamily} has none of the subsets ${wanted.join(", ")}`);

  const groups = new Map();
  for (const face of faces) {
    if (!priority.includes(face.subset)) continue;
    const key = faceKey(face);
    if (!groups.has(key)) groups.set(key, { style: face.style, weight: face.weight, faces: [], need: new Set(), axes: undefined });
    const group = groups.get(key);
    const bytes = await fetchRequired(face.url, label);
    const tables = readWoff2Tables(bytes, `${label} ${face.url}`);
    const range = face.unicodeRange ? parseUnicodeRange(face.unicodeRange) : undefined;
    for (const codepoint of cmapCodepoints(tables, label)) {
      if (codepoint >= 0x20 && (!range || range.has(codepoint))) group.need.add(codepoint);
    }
    const faceAxes = variationAxes(tables);
    if (group.axes !== undefined && group.axes !== faceAxes) fail(`${label}: inconsistent variation axes across subsets of ${key}`);
    group.axes = faceAxes;
    group.faces.push({ ...face, bytes });
  }

  const union = new Set([...groups.values()].flatMap((group) => [...group.need]));
  let mode = "text";
  let reason = "";
  const merged = new Map();
  if (union.size > TEXT_PARAM_LIMIT) {
    mode = "subsets";
    reason = `${union.size} codepoints exceed the ${TEXT_PARAM_LIMIT}-character text= limit`;
  } else {
    const text = [...union].sort((a, b) => a - b).map((c) => String.fromCodePoint(c)).join("");
    const textFaces = parseFontFaces((await fetchRequired(`${cssUrl}&text=${encodeURIComponent(text)}`, label)).toString("utf8"), label);
    const textKeys = new Set(textFaces.map(faceKey));
    if (textFaces.length !== groups.size || [...groups.keys()].some((key) => !textKeys.has(key))) {
      mode = "subsets";
      reason = "text= response does not map 1:1 onto the requested styles/weights";
    } else {
      for (const face of textFaces) {
        const group = groups.get(faceKey(face));
        const bytes = await fetchRequired(face.url, label);
        const tables = readWoff2Tables(bytes, `${label} ${face.url}`);
        const covered = cmapCodepoints(tables, label);
        const missing = [...group.need].filter((c) => !covered.has(c));
        if (missing.length > 0) {
          mode = "subsets";
          reason = `text= font misses ${missing.length} codepoints of Google's subset files`;
          break;
        }
        if (variationAxes(tables) !== group.axes) {
          mode = "subsets";
          reason = `text= font axes (${variationAxes(tables)}) differ from subset files (${group.axes})`;
          break;
        }
        merged.set(faceKey(face), bytes);
      }
    }
  }

  const src = [];
  if (mode === "text") {
    for (const [key, group] of groups) src.push({ bytes: merged.get(key), style: group.style, weight: group.weight, label: `${group.style}-${group.weight}` });
  } else {
    for (const subset of [...priority].reverse()) {
      for (const group of groups.values()) {
        for (const face of group.faces.filter((f) => f.subset === subset)) {
          src.push({ bytes: face.bytes, style: face.style, weight: face.weight, label: `${face.style}-${face.weight}-${subset}` });
        }
      }
    }
  }

  let adjustFontFallback = false;
  if (validated.adjustFontFallback !== false) {
    try {
      adjustFontFallback = toolchain.calculateSizeAdjustValues(fontFamily).fallbackFont;
    } catch {
      adjustFontFallback = false;
    }
  }

  const lost = [];
  if (src.length > 1 && validated.styles.length === 1 && validated.styles[0] !== "italic") lost.push(`font-style: ${validated.styles[0]}`);
  if (src.length > 1 && validated.weights.length === 1 && validated.weights[0] !== "variable") lost.push(`font-weight: ${validated.weights[0]}`);
  return {
    fontFamily,
    cssUrl,
    mode,
    reason,
    subsets: priority,
    codepoints: union.size,
    src,
    adjustFontFallback,
    lost,
  };
}

async function fetchLicense(fontFamily, label) {
  const dir = fontFamily.toLowerCase().replace(/[^a-z0-9]/g, "");
  const candidates = [
    ["ofl", "OFL.txt", "OFL"],
    ["apache", "LICENSE.txt", "LICENSE"],
    ["ufl", "UFL.txt", "UFL"],
  ];
  for (const [kind, file, prefix] of candidates) {
    const bytes = await fetchBytes(`https://raw.githubusercontent.com/google/fonts/main/${kind}/${dir}/${file}`, label);
    if (bytes) return { name: `${prefix}-${fontFamily.replace(/[^A-Za-z0-9]/g, "")}.txt`, bytes };
  }
  fail(`${label}: no license found for ${fontFamily} in github.com/google/fonts (ofl/apache/ufl/${dir})`);
}

function detectStyle(text, node, sourceFile) {
  const importText = node.getText(sourceFile);
  const quote = importText.includes("'") && !importText.includes('"') ? "'" : '"';
  const semicolon = importText.trimEnd().endsWith(";");
  const indentMatch = text.match(/\n( +|\t)\S/);
  const indent = indentMatch ? (indentMatch[1].startsWith("\t") ? "\t" : " ".repeat(Math.min(indentMatch[1].length, 4))) : "  ";
  return { quote, semicolon, indent };
}

function quoteString(value, quote) {
  return `${quote}${value.replace(/\\/g, "\\\\").replace(new RegExp(quote, "g"), `\\${quote}`)}${quote}`;
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function relativeImport(fromFile, toFile) {
  const relative = toPosix(path.relative(path.dirname(fromFile), toFile));
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function propertyIndent(call, fallback) {
  const first = call.properties[0]?.node;
  if (!first) return fallback;
  const source = first.getSourceFile().text;
  const start = first.getStart();
  const lineBegin = lineStart(source, start);
  const leading = source.slice(lineBegin, start);
  return lineBegin > call.object.getStart() && /^[ \t]+$/.test(leading) ? leading : fallback;
}

function renderLocalFont(call, font, fileNames, fromFile, fontsDir, style, callee) {
  const { quote } = style;
  const indent = propertyIndent(call, style.indent);
  const baseIndent = "";
  const i1 = baseIndent + indent;
  const i2 = i1 + indent;
  const q = (value) => quoteString(value, quote);
  const objectText = call.object?.getText() ?? "";
  const trailingComma = objectText.includes("\n") ? /,\s*$/.test(objectText.slice(0, -1)) : true;
  const pathOf = (entry) => q(relativeImport(fromFile, path.join(fontsDir, fileNames.get(entry))));
  const lines = [];
  if (font.src.length === 1) {
    const [entry] = font.src;
    lines.push(`${i1}src: ${pathOf(entry)},`, `${i1}weight: ${q(entry.weight)},`, `${i1}style: ${q(entry.style)},`);
  } else {
    lines.push(`${i1}src: [`);
    for (const entry of font.src) lines.push(`${i2}{ path: ${pathOf(entry)}, weight: ${q(entry.weight)}, style: ${q(entry.style)} },`);
    lines.push(`${i1}],`);
  }
  const adjust = font.adjustFontFallback === "Arial" ? undefined : font.adjustFontFallback === false ? "false" : q(font.adjustFontFallback);
  let adjustEmitted = false;
  const body = [];
  for (const property of call.properties) {
    if (CARRIED_OPTIONS.has(property.key)) body.push(property.text);
    else if (property.key === "adjustFontFallback" && adjust !== undefined) {
      body.push(`adjustFontFallback: ${adjust}`);
      adjustEmitted = true;
    }
  }
  if (adjust !== undefined && !adjustEmitted) body.push(`adjustFontFallback: ${adjust}`);
  body.forEach((entry, index) => {
    lines.push(`${i1}${entry}${index < body.length - 1 || trailingComma ? "," : ""}`);
  });
  return `${callee}({\n${lines.join("\n")}\n${baseIndent}})`;
}

function lineStart(text, position) {
  return text.lastIndexOf("\n", position - 1) + 1;
}

function removalRange(text, statement, sourceFile) {
  const start = lineStart(text, statement.getStart(sourceFile));
  let end = statement.end;
  while (end < text.length && text[end] !== "\n") {
    if (!/\s/.test(text[end])) return [statement.getStart(sourceFile), statement.end];
    end++;
  }
  end++;
  while (end < text.length) {
    const next = text.indexOf("\n", end);
    const line = text.slice(end, next === -1 ? text.length : next);
    if (line.trim() !== "" || next === -1) break;
    end = next + 1;
  }
  return [start, end];
}

function applyEdits(text, edits) {
  let result = text;
  for (const { start, end, replacement } of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, start) + replacement + result.slice(end);
  }
  return result;
}

function readAliases(toolchain, root) {
  const { ts } = toolchain;
  const configPath = ["tsconfig.json", "jsconfig.json"].map((f) => path.join(root, f)).find(existsSync);
  if (!configPath) return [];
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  const options = parsed?.options ?? {};
  const base = options.baseUrl ?? options.pathsBasePath ?? path.dirname(configPath);
  const aliases = [];
  for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
    if (!pattern.endsWith("/*") || targets.length !== 1 || !targets[0].endsWith("/*")) continue;
    aliases.push({ prefix: pattern.slice(0, -1), dir: path.resolve(base, targets[0].slice(0, -2)) });
  }
  return aliases;
}

function moduleSpecifier(aliases, analysis, modulePath) {
  const withoutExt = modulePath.replace(/\.(ts|tsx|js|jsx|mjs|mts)$/, "").replace(/\/index$/, "");
  for (const { prefix, dir } of aliases) {
    if (!withoutExt.startsWith(dir + path.sep)) continue;
    if (!analysis.text.includes(`"${prefix}`) && !analysis.text.includes(`'${prefix}`)) continue;
    return `${prefix}${toPosix(path.relative(dir, withoutExt))}`;
  }
  return relativeImport(analysis.file, withoutExt);
}

function findFamilyReferences(root, families, generated) {
  const notes = [];
  const files = walk(root).concat(walkCss(root)).filter((file) => !generated.has(file));
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const family of families) {
        const match = new RegExp(`(["'])${family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`).exec(line);
        if (match && /font/i.test(line) && !line.slice(0, match.index).includes("var(")) {
          notes.push(`${path.relative(root, file)}:${index + 1}: literal '${family}' now resolves only as an installed system font`);
        }
      }
    });
  }
  return notes;
}

function walkCss(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) walkCss(path.join(dir, entry.name), out);
    } else if (/\.(css|scss|sass|less)$/.test(entry.name)) out.push(path.join(dir, entry.name));
  }
  return out;
}

function check(root) {
  const remaining = findCandidateFiles(root);
  if (remaining.length === 0) {
    console.log("OK: no Google font loader imports remain");
    return 0;
  }
  console.error(`Google font loader still referenced in:\n${remaining.map((f) => `  ${path.relative(root, f)}`).join("\n")}`);
  return 1;
}

async function convert(args) {
  const { root } = args;
  const candidates = findCandidateFiles(root);
  if (candidates.length === 0) {
    console.log("Nothing to do: no Google font loader imports found");
    return 0;
  }
  const toolchain = loadToolchain(root);
  const fontsDir = path.resolve(root, args.fontsDir ?? (existsSync(path.join(root, "src")) ? "src/fonts" : "fonts"));
  const modulePath = path.resolve(root, args.module ?? path.join(fontsDir, "index.ts"));
  const analyses = candidates.map((file) => analyzeFile(toolchain, root, file));
  const unparsed = candidates.filter((_, index) => !analyses[index]);
  if (unparsed.length > 0) fail(`Google font loader referenced outside an import in:\n${unparsed.map((f) => `  ${path.relative(root, f)}`).join("\n")}`);

  console.log(`next ${toolchain.nextVersion}, typescript ${toolchain.ts.version}`);
  const files = new Map();
  const fileNames = new Map();
  const licenses = new Map();
  const warnings = [];
  const resolved = new Map();
  for (const analysis of analyses) {
    for (const call of analysis.calls) {
      const font = await resolveFont(toolchain, call, args.extraSubsets);
      resolved.set(call, font);
      for (const entry of font.src) {
        const hash = createHash("sha256").update(entry.bytes).digest("hex").slice(0, 8);
        const existing = [...files.entries()].find(([, bytes]) => bytes.equals(entry.bytes));
        const name = existing ? existing[0] : `${slug(font.fontFamily)}-${slug(entry.label)}-${hash}.woff2`;
        files.set(name, entry.bytes);
        fileNames.set(entry, name);
      }
      if (!licenses.has(font.fontFamily)) licenses.set(font.fontFamily, await fetchLicense(font.fontFamily, call.where));
      const size = [...new Set(font.src.map((entry) => entry.bytes))].reduce((total, bytes) => total + bytes.length, 0);
      console.log(
        `${call.where} ${call.name} = ${font.fontFamily}: ${font.mode === "text" ? "merged text= subset" : "Google subset files"} ` +
          `[${font.subsets.join(", ")}], ${font.codepoints} codepoints, ${new Set(font.src.map((e) => e.bytes)).size} file(s), ${(size / 1024).toFixed(1)} KiB` +
          (font.reason ? ` (${font.reason})` : ""),
      );
      if (font.lost.length > 0) {
        warnings.push(
          `${call.where}: ${call.name} needs ${font.src.length} files, so .className/.style no longer set ${font.lost.join(" and ")} (next/font/local only sets them for a single src)`,
        );
      }
    }
  }

  const moved = analyses.filter((analysis) => JSX_EXTENSIONS.has(path.extname(analysis.file)));
  const moduleExports = new Map();
  let moduleStyle;
  if (moved.length > 0 && existsSync(modulePath)) fail(`${path.relative(root, modulePath)} already exists; pass --module <new-file>`);

  const outputs = new Map();
  for (const analysis of analyses) {
    const style = detectStyle(analysis.text, analysis.importNode, analysis.sourceFile);
    const semi = style.semicolon ? ";" : "";
    const q = (value) => quoteString(value, style.quote);
    if (!moved.includes(analysis)) {
      const edits = analysis.calls.map((call) => ({
        start: call.call.getStart(analysis.sourceFile),
        end: call.call.end,
        replacement: renderLocalFont(call, resolved.get(call), fileNames, analysis.file, fontsDir, style, analysis.localFontImport ?? "localFont"),
      }));
      const importRange = { start: analysis.importNode.getStart(analysis.sourceFile), end: analysis.importNode.end };
      if (analysis.localFontImport) {
        const [start, end] = removalRange(analysis.text, analysis.importNode, analysis.sourceFile);
        edits.push({ start, end, replacement: "" });
      } else {
        edits.push({ ...importRange, replacement: `import localFont from ${q(LOCAL_SPECIFIER)}${semi}` });
      }
      outputs.set(analysis.file, applyEdits(analysis.text, edits));
      continue;
    }
    const imported = [];
    const reexported = [];
    const edits = [];
    for (const call of analysis.calls) {
      const rendered = renderLocalFont(call, resolved.get(call), fileNames, modulePath, fontsDir, style, "localFont");
      let exportName = call.name;
      for (let n = 2; moduleExports.has(exportName) && moduleExports.get(exportName) !== rendered; n++) exportName = `${call.name}${n}`;
      moduleExports.set(exportName, rendered);
      moduleStyle ??= style;
      imported.push(exportName === call.name ? call.name : `${exportName} as ${call.name}`);
      if (call.exported) reexported.push(call.name);
      const [start, end] = removalRange(analysis.text, call.statement, analysis.sourceFile);
      edits.push({ start, end, replacement: "" });
    }
    const specifier = moduleSpecifier(readAliases(toolchain, root), analysis, modulePath);
    const replacement =
      `import { ${imported.join(", ")} } from ${q(specifier)}${semi}` + (reexported.length ? `\nexport { ${reexported.join(", ")} }${semi}` : "");
    edits.push({ start: analysis.importNode.getStart(analysis.sourceFile), end: analysis.importNode.end, replacement });
    outputs.set(analysis.file, applyEdits(analysis.text, edits));
  }

  if (moduleExports.size > 0) {
    const semi = moduleStyle.semicolon ? ";" : "";
    const body = [...moduleExports.entries()].map(([name, rendered]) => `export const ${name} = ${rendered}${semi}`);
    outputs.set(modulePath, `import localFont from ${quoteString(LOCAL_SPECIFIER, moduleStyle.quote)}${semi}\n\n${body.join("\n\n")}\n`);
  }

  mkdirSync(fontsDir, { recursive: true });
  for (const [name, bytes] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) writeFileSync(path.join(fontsDir, name), bytes);
  for (const { name, bytes } of [...licenses.values()].sort((a, b) => a.name.localeCompare(b.name))) writeFileSync(path.join(fontsDir, name), bytes);
  for (const [file, content] of [...outputs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    console.log(`wrote ${path.relative(root, file)}`);
  }
  console.log(`wrote ${files.size} font file(s) and ${licenses.size} license file(s) to ${path.relative(root, fontsDir)}`);

  const families = [...new Set([...resolved.values()].map((font) => font.fontFamily))];
  const notes = findFamilyReferences(root, families, new Set(outputs.keys()));
  for (const warning of [...warnings, ...notes]) console.warn(`warning: ${warning}`);
  return check(root);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  return args.check ? check(args.root) : convert(args);
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof ToolError ? `error: ${error.message}` : error);
    process.exit(2);
  },
);
