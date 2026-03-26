import type { ParsedTrack } from "../types.js";
import { getGMInstrumentLabel } from "./gm-programs.js";

export interface TrackInfo {
  index:           number;
  name:            string;
  midiProgram:     number;
  midiChannel:     number;
  noteCount:       number;
  isSaxophone:     boolean;
  instrumentLabel: string;
}

export interface ListTracksResult {
  title:   string;
  artist:  string;
  format:  "midi" | "gpx" | "gp";
  tracks:  TrackInfo[];
}

export function tracksToTrackInfos(tracks: ParsedTrack[]): TrackInfo[] {
  return tracks.map((t) => ({
    index:           t.id,
    name:            t.name,
    midiProgram:     t.midiProgram,
    midiChannel:     t.midiChannel,
    noteCount:       t.notes.length,
    isSaxophone:     t.isSaxophone,
    instrumentLabel: getGMInstrumentLabel(t.midiProgram),
  }));
}

/**
 * Liste les pistes d'un fichier sans effectuer de conversion complète.
 * Dispatche automatiquement entre MIDI et Guitar Pro selon l'extension.
 */
export async function listTracksFromBuffer(
  fileBuffer: Buffer | Uint8Array,
  ext: string
): Promise<ListTracksResult> {
  const normalizedExt = ext.replace(/^\./, "").toLowerCase();

  if (normalizedExt === "mid" || normalizedExt === "midi") {
    const { parseMidi } = await import("../parsers/midi-parser.js");
    const parsed = parseMidi(fileBuffer);
    return {
      title:  parsed.title,
      artist: parsed.artist,
      format: "midi",
      tracks: tracksToTrackInfos(parsed.tracks),
    };
  }

  const { parseGuitarPro } = await import("../parsers/gp-parser.js");
  // expandRepeats=false : on veut juste la liste, pas le décompte des notes répétées
  const parsed = await parseGuitarPro(fileBuffer, { expandRepeats: false });
  return {
    title:  parsed.title,
    artist: parsed.artist,
    format: parsed.sourceFormat,
    tracks: tracksToTrackInfos(parsed.tracks),
  };
}
