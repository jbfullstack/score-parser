// ============================================================
// parseFile — dispatcher unifié tous formats
// ============================================================
// Point d'entrée recommandé pour les consommateurs qui ne
// veulent pas gérer le dispatch MIDI vs Guitar Pro.
// ============================================================

import type { ParsedScore } from "./types.js";
import type { GpParseOptions } from "./parsers/gp-parser.js";

export interface ParseFileOptions extends GpParseOptions {
  /**
   * Extension du fichier source (avec ou sans point).
   * Requis sauf si les magic bytes permettent l'auto-détection.
   */
  ext?: string;
}

// Magic bytes des formats supportés
// MIDI   : "MThd" (0x4D 0x54 0x68 0x64)
// GP/GPX : ZIP   (0x50 0x4B 0x03 0x04)  — les formats GP4+ sont zippés
// GP3    : commence souvent par FICHIER_MAGIC_RIFF ou header GP3 spécifique
/** Détecte le format d'un buffer depuis ses magic bytes. Exporté pour les tests. */
export function detectFormatFromBytes(buf: Buffer | Uint8Array): "midi" | "gp" | null {
  if (buf.length < 4) return null;
  // MIDI
  if (buf[0] === 0x4D && buf[1] === 0x54 && buf[2] === 0x68 && buf[3] === 0x64) return "midi";
  // ZIP (GPX, GP5, GP4 compressés)
  if (buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04) return "gp";
  return null;
}

const GP_EXTENSIONS = new Set(["gp", "gp3", "gp4", "gp5", "gpx"]);
const MIDI_EXTENSIONS = new Set(["mid", "midi"]);

/**
 * Parse un fichier musical depuis son buffer binaire.
 *
 * @param fileBuffer - Buffer du fichier
 * @param options    - Options dont `ext` pour forcer le format
 * @returns ParsedScore en concert pitch
 *
 * @throws Si le format ne peut pas être déterminé
 *
 * @example
 * ```ts
 * const buf = await fs.readFile("song.gp5");
 * const score = await parseFile(buf, { ext: "gp5" });
 * const sax = score.tracks.find(t => t.isSaxophone);
 * console.log(sax?.notes.length, "notes");
 * ```
 */
export async function parseFile(
  fileBuffer: Buffer | Uint8Array,
  options: ParseFileOptions = {}
): Promise<ParsedScore> {
  const ext = (options.ext ?? "").replace(/^\./, "").toLowerCase();

  if (MIDI_EXTENSIONS.has(ext)) {
    const { parseMidi } = await import("./parsers/midi-parser.js");
    return parseMidi(fileBuffer);
  }

  if (GP_EXTENSIONS.has(ext)) {
    const { parseGuitarPro } = await import("./parsers/gp-parser.js");
    return parseGuitarPro(fileBuffer, { expandRepeats: options.expandRepeats ?? true });
  }

  // Auto-détection par magic bytes si ext absent ou inconnu
  const detected = detectFormatFromBytes(fileBuffer);
  if (detected === "midi") {
    const { parseMidi } = await import("./parsers/midi-parser.js");
    return parseMidi(fileBuffer);
  }
  if (detected === "gp") {
    const { parseGuitarPro } = await import("./parsers/gp-parser.js");
    return parseGuitarPro(fileBuffer, { expandRepeats: options.expandRepeats ?? true });
  }

  throw new Error(
    `Unsupported format${ext ? ` ".${ext}"` : ""}. ` +
    `Accepted: mid, midi, gp, gp3, gp4, gp5, gpx.`
  );
}
