// ============================================================
// ParsedScore — format intermédiaire neutre
// ============================================================
// Toutes les hauteurs sont en MIDI concert pitch (pitch sonnant).
// La transposition written → concert est appliquée dans chaque parseur.
// PPQ interne : 480 ticks par noire.
// ============================================================

export interface ParsedNote {
  pitchMidi:     number;        // MIDI concert pitch (60 = C4)
  startTick:     number;        // Position absolue depuis le début (ticks)
  durationTicks: number;        // Durée en ticks
  velocity:      number;        // 0–127
  isRest?:       boolean;
  /** Effets de jeu issus du fichier source (informatif, non joué) */
  annotations?:  string[];      // ex: ["bend", "vibrato", "hammer-on"]
}

export interface ParsedTempoChange {
  tick: number;
  bpm:  number;                 // BPM avec 2 décimales max
}

export interface ParsedTimeSigChange {
  tick:        number;
  numerator:   number;
  denominator: number;
}

export interface ParsedKeySigChange {
  tick:   number;
  fifths: number;               // -7 (7 bémols) à +7 (7 dièses)
  mode:   "major" | "minor";
}

export interface ParsedTrack {
  id:          number;
  name:        string;
  midiProgram: number;          // 0–127 (GM spec)
  midiChannel: number;
  notes:       ParsedNote[];
  isSaxophone: boolean;
}

export interface ParsedScore {
  title:        string;
  artist:       string;
  composer:     string;
  ppq:          number;         // Pulses Per Quarter note
  tracks:       ParsedTrack[];
  tempos:       ParsedTempoChange[];
  timeSigs:     ParsedTimeSigChange[];
  keySigs:      ParsedKeySigChange[];
  sourceFormat: "midi" | "gpx" | "gp";
}

// ── Saxophone detection ───────────────────────────────────────

/** Programmes MIDI General MIDI correspondant aux saxophones */
export const SAX_MIDI_PROGRAMS = new Set([64, 65, 66, 67]);
//                                        Sop Alto Ten Bari

export function detectSaxTrack(track: Pick<ParsedTrack, "name" | "midiProgram">): boolean {
  if (SAX_MIDI_PROGRAMS.has(track.midiProgram)) return true;
  const n = track.name.toLowerCase();
  return (
    n.includes("sax") ||
    n.includes("saxophone") ||
    n.includes("alto") ||
    n.includes("tenor") ||
    n.includes("soprano") ||
    n.includes("baryton") ||
    n.includes("baritone")
  );
}
