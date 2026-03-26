#!/usr/bin/env node
// ============================================================
// score-parser CLI
// ============================================================
// Usage : npx score-parser <file> [options]
//
// Options:
//   --list-tracks            Liste les pistes sans parser
//   --track <n>              Sélectionner la piste n (défaut: auto-detect sax)
//   --format <fmt>           json | musicxml | abc  (défaut: json)
//   --out <file>             Fichier de sortie (défaut: stdout)
//   --no-expand-repeats      Désactiver le déroulement des répétitions
//   --help, -h               Afficher l'aide
// ============================================================

import { readFile, writeFile } from "node:fs/promises";
import { extname, basename } from "node:path";
import process from "node:process";

// ── Arg parser léger (sans dépendance) ───────────────────────

interface ParsedArgs {
  file:          string | undefined;
  listTracks:    boolean;
  track:         number | undefined;
  format:        "json" | "musicxml" | "abc";
  out:           string | undefined;
  expandRepeats: boolean;
  help:          boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    file:          undefined,
    listTracks:    false,
    track:         undefined,
    format:        "json",
    out:           undefined,
    expandRepeats: true,
    help:          false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    switch (a) {
      case "--list-tracks":     result.listTracks    = true; break;
      case "--no-expand-repeats": result.expandRepeats = false; break;
      case "--help": case "-h": result.help          = true; break;
      case "--track":
        result.track = parseInt(args[++i] ?? "0", 10); break;
      case "--format":
        result.format = (args[++i] ?? "json") as "json" | "musicxml" | "abc"; break;
      case "--out":
        result.out = args[++i]; break;
      default:
        if (!a.startsWith("-")) result.file = a;
        break;
    }
  }
  return result;
}

// ── Aide ─────────────────────────────────────────────────────

const HELP = `
score-parser — Parse MIDI and Guitar Pro files to structured JSON

Usage:
  npx score-parser <file> [options]

Options:
  --list-tracks          List tracks without full parse
  --track <n>            Select track n (default: auto-detect saxophone)
  --format <fmt>         Output format: json | musicxml | abc  (default: json)
  --out <file>           Output file  (default: stdout)
  --no-expand-repeats    Do not unfold repeat signs
  -h, --help             Show this help

Examples:
  npx score-parser song.gp5 --list-tracks
  npx score-parser song.gp5 --track 2 --format musicxml --out song.xml
  npx score-parser song.mid --format json | jq '.tracks[0].notes | length'
`.trim();

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help || !args.file) {
    process.stdout.write(HELP + "\n");
    process.exit(args.help ? 0 : 1);
  }

  // Validation du format de sortie
  if (!["json", "musicxml", "abc"].includes(args.format)) {
    process.stderr.write(`Error: unknown format "${args.format}". Use: json, musicxml, abc\n`);
    process.exit(1);
  }

  const filePath = args.file;
  const ext = extname(filePath).replace(/^\./, "").toLowerCase();

  let fileBuffer: Buffer;
  try {
    fileBuffer = await readFile(filePath);
  } catch {
    process.stderr.write(`Error: cannot read file "${filePath}"\n`);
    process.exit(1);
  }

  // ── --list-tracks ──
  if (args.listTracks) {
    const { listTracksFromBuffer } = await import("../src/utils/list-tracks.js");
    const result = await listTracksFromBuffer(fileBuffer, ext);
    const label = `${basename(filePath)} — ${result.title || "(no title)"} [${result.format}]`;
    process.stdout.write(`${label}\n`);
    process.stdout.write(`${"─".repeat(label.length)}\n`);
    for (const t of result.tracks) {
      const sax = t.isSaxophone ? " ★" : "";
      process.stdout.write(
        `  [${t.index}] ${t.name.padEnd(24)} ${t.instrumentLabel.padEnd(28)} ${t.noteCount} notes${sax}\n`
      );
    }
    return;
  }

  // ── Parsing complet ──
  const { parseFile } = await import("../src/parse-file.js");
  const score = await parseFile(fileBuffer, {
    ext,
    expandRepeats: args.expandRepeats,
  });

  // Sélection du track
  let trackIndex: number;
  if (args.track !== undefined) {
    trackIndex = args.track;
  } else {
    // Auto-detect saxophone, sinon track 0
    trackIndex = score.tracks.findIndex((t) => t.isSaxophone);
    if (trackIndex === -1) trackIndex = 0;
  }

  if (trackIndex >= score.tracks.length) {
    process.stderr.write(
      `Error: track ${trackIndex} not found. File has ${score.tracks.length} track(s).\n`
    );
    process.exit(1);
  }

  // ── Génération de la sortie ──
  let output: string;
  switch (args.format) {
    case "json":
      output = JSON.stringify(score, null, 2);
      break;
    case "musicxml": {
      const { scoreToMusicXML } = await import("../src/exporters/to-musicxml.js");
      output = scoreToMusicXML(score, trackIndex);
      break;
    }
    case "abc": {
      const { scoreToABC } = await import("../src/exporters/to-abc.js");
      output = scoreToABC(score, trackIndex);
      break;
    }
  }

  if (args.out) {
    await writeFile(args.out, output, "utf-8");
    process.stderr.write(`Written to ${args.out}\n`);
  } else {
    process.stdout.write(output + "\n");
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
