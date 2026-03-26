// ============================================================
// score-parser — public API
// ============================================================

// ── Parsers ──────────────────────────────────────────────────
export { parseMidi }              from "./parsers/midi-parser.js";
export { parseGuitarPro }         from "./parsers/gp-parser.js";
export { parseFile }              from "./parse-file.js";

// ── Utils ────────────────────────────────────────────────────
export { listTracksFromBuffer, tracksToTrackInfos } from "./utils/list-tracks.js";
export { getGMInstrumentLabel, GM_PROGRAM_NAMES }   from "./utils/gm-programs.js";

// ── Exporters ────────────────────────────────────────────────
export { scoreToMusicXML }        from "./exporters/to-musicxml.js";
export { scoreToABC }             from "./exporters/to-abc.js";

// ── Types ────────────────────────────────────────────────────
export type {
  ParsedScore,
  ParsedTrack,
  ParsedNote,
  ParsedTempoChange,
  ParsedTimeSigChange,
  ParsedKeySigChange,
} from "./types.js";

export { detectSaxTrack, SAX_MIDI_PROGRAMS } from "./types.js";

export type { MidiParseOptions }   from "./parsers/midi-parser.js";
export type { GpParseOptions }     from "./parsers/gp-parser.js";
export type { ParseFileOptions }   from "./parse-file.js";
export type { TrackInfo, ListTracksResult } from "./utils/list-tracks.js";
