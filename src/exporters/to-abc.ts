// ============================================================
// Exporter ABC Notation (standard v2.1)
// ============================================================
// Format texte léger, très utilisé pour la musique folk/traditionnelle.
// Référence : https://abcnotation.com/wiki/abc:standard:v2.1
//
// Ce que cette v1 gère :
//   pitch, duration, rests, time signature, key, tempo, title
// Ce que cette v1 ne gère pas :
//   ornements, liaisons, dynamiques, barres de reprise
// ============================================================

import type {
  ParsedScore,
  ParsedNote,
  ParsedTimeSigChange,
  ParsedKeySigChange,
} from "../types.js";

// ── Conversion pitch MIDI → ABC ───────────────────────────────
//
// ABC standard :
//   Octave 3 (C3..B3) → C,  D,  ... B,   (majuscule + virgule)
//   Octave 4 (C4..B4) → C   D   ... B    (majuscule, octave de référence)
//   Octave 5 (C5..B5) → c   d   ... b    (minuscule)
//   Octave 6 (C6..B6) → c'  d'  ... b'   (minuscule + apostrophe)
//   Plus haut → apostrophes supplémentaires
//   Plus bas  → virgules supplémentaires
//
// Altérations : ^C = C#, _B = Bb, =C = do bécarre explicite

const NOTE_NAMES_SHARP = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
const IS_SHARP         = [  0,  1,   0,   1,   0,   0,   1,   0,   1,   0,   1,   0];

function midiToABC(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1; // 4 = octave de référence ABC

  const isSharp = IS_SHARP[pc] === 1;
  const baseName = NOTE_NAMES_SHARP[pc]!;
  const prefix = isSharp ? "^" : "";

  if (octave <= 4) {
    // Majuscule
    const commas = octave <= 3 ? ",".repeat(Math.max(0, 4 - octave)) : "";
    return `${prefix}${baseName}${commas}`;
  } else {
    // Minuscule + apostrophes
    const lower = baseName.toLowerCase();
    const apostrophes = "'".repeat(octave - 5);
    return `${prefix}${lower}${apostrophes}`;
  }
}

// ── Conversion durée ticks → ABC ─────────────────────────────
//
// La longueur de note de référence (L:) est 1/8 (croche).
// Durées ABC relatives à L=1/8 :
//   Ronde   = 8  → "8"
//   Blanche = 4  → "4"
//   Noire   = 2  → "2"  (ou omis si = 1)
//   Croche  = 1  → ""
//   Double  = /2 → "/2"
//   Triple  = /4 → "/4"

const UNIT_NOTE = 1 / 8; // L: 1/8

function ticksToDuration(ticks: number, ppq: number): string {
  // On exprime la durée en fraction de ronde (whole note = ppq*4)
  const whole = ppq * 4;
  const ratio = ticks / whole; // 1.0 = ronde, 0.25 = noire, etc.

  // Rapport par rapport à L (1/8) — doit être une fraction simple
  const relToL = ratio / UNIT_NOTE; // noire (0.25 / 0.125) = 2

  // Arrondir au rationnel le plus proche parmi les valeurs standard
  const STANDARD: Array<[number, string]> = [
    [8,    "8"],     // ronde (= 8 croches)
    [7,    "7"],     // ronde double pointée (rare)
    [6,    "6"],     // ronde pointée
    [4,    "4"],     // blanche
    [3,    "3"],     // blanche pointée
    [2,    "2"],     // noire
    [1.5,  "3/2"],   // croche pointée
    [1,    ""],      // croche (L = unité, durée omise)
    [0.5,  "/2"],    // double croche
    [0.25, "/4"],    // triple croche
    [0.125,"/8"],    // quadruple croche
  ];

  // Trouver la correspondance la plus proche
  let closest = "";
  let minDiff = Infinity;
  for (const [val, sym] of STANDARD) {
    const diff = Math.abs(relToL - val);
    if (diff < minDiff) {
      minDiff = diff;
      closest = sym;
    }
  }
  return closest;
}

// ── Reconstruction des mesures ────────────────────────────────

interface ABCMeasure {
  startTick: number;
  endTick:   number;
  timeSig:   ParsedTimeSigChange;
  notes:     ParsedNote[];
}

function buildABCMeasures(
  notes: ParsedNote[],
  timeSigs: ParsedTimeSigChange[],
  ppq: number
): ABCMeasure[] {
  if (notes.length === 0) return [];

  const totalTicks = Math.max(...notes.map((n) => n.startTick + n.durationTicks));
  const measures: ABCMeasure[] = [];
  let tick = 0;
  let sigIdx = 0;

  while (tick < totalTicks) {
    while (sigIdx + 1 < timeSigs.length && (timeSigs[sigIdx + 1]?.tick ?? Infinity) <= tick) {
      sigIdx++;
    }
    const sig = timeSigs[sigIdx] ?? { tick: 0, numerator: 4, denominator: 4 };
    const barTicks = (ppq * 4 * sig.numerator) / sig.denominator;
    const barEnd = tick + barTicks;

    measures.push({
      startTick: tick,
      endTick:   barEnd,
      timeSig:   sig,
      notes:     notes.filter((n) => n.startTick >= tick && n.startTick < barEnd),
    });

    tick = barEnd;
  }
  return measures;
}

// ── Armure → clé ABC ─────────────────────────────────────────

const FIFTHS_TO_KEY: Readonly<Record<number, string>> = {
  [-7]: "Cb", [-6]: "Gb", [-5]: "Db", [-4]: "Ab", [-3]: "Eb",
  [-2]: "Bb", [-1]: "F",  [0]: "C",   [1]: "G",   [2]: "D",
  [3]: "A",   [4]: "E",   [5]: "B",   [6]: "F#",  [7]: "C#",
};

function keySigToABC(fifths: number, mode: "major" | "minor"): string {
 const base = FIFTHS_TO_KEY[fifths] ?? "C";
  return mode === "minor" ? `${base}m` : base;
}

// ── Export principal ──────────────────────────────────────────

/**
 * Convertit un ParsedScore en ABC Notation (v2.1).
 *
 * @param score      - Résultat du parseur
 * @param trackIndex - Index du track à exporter (défaut: 0)
 * @returns String ABC
 */
export function scoreToABC(score: ParsedScore, trackIndex = 0): string {
  const track = score.tracks[trackIndex];
  if (!track) throw new Error(`Track ${trackIndex} not found (${score.tracks.length} tracks).`);

  const keySig  = score.keySigs[0] ?? { fifths: 0, mode: "major" as const };
  const timeSig = score.timeSigs[0] ?? { tick: 0, numerator: 4, denominator: 4 };
  const tempo   = score.tempos[0] ?? { tick: 0, bpm: 120 };

  const lines: string[] = [];

  // ── Header ABC ──
  lines.push(`X:1`);
  if (score.title)    lines.push(`T:${score.title}`);
  if (score.composer) lines.push(`C:${score.composer}`);
  if (score.artist)   lines.push(`Z:${score.artist}`);  // Z = transcriber / source
  lines.push(`M:${timeSig.numerator}/${timeSig.denominator}`);
  lines.push(`L:1/8`);                                  // unité de base = croche
  lines.push(`Q:1/4=${Math.round(tempo.bpm)}`);         // Q en noires/min
  lines.push(`K:${keySigToABC(keySig.fifths, keySig.mode)}`);

  // ── Corps ──
  const measures = buildABCMeasures(track.notes, score.timeSigs, score.ppq);

  if (measures.length === 0) {
    lines.push("z4 |");  // mesure vide
    return lines.join("\n");
  }

  const barTokens: string[] = [];

  for (const measure of measures) {
    const barNotes = [...measure.notes].sort((a, b) => a.startTick - b.startTick);
    let cursor = measure.startTick;
    const tokens: string[] = [];

    for (const note of barNotes) {
      // Silence avant la note
      if (note.startTick > cursor) {
        const restDur = ticksToDuration(note.startTick - cursor, score.ppq);
        tokens.push(`z${restDur}`);
      }
      if (note.isRest) {
        const restDur = ticksToDuration(note.durationTicks, score.ppq);
        tokens.push(`z${restDur}`);
      } else {
        const abcNote = midiToABC(note.pitchMidi);
        const dur     = ticksToDuration(note.durationTicks, score.ppq);
        tokens.push(`${abcNote}${dur}`);
      }
      cursor = note.startTick + note.durationTicks;
    }

    // Silence de fin de mesure
    if (cursor < measure.endTick) {
      const restDur = ticksToDuration(measure.endTick - cursor, score.ppq);
      tokens.push(`z${restDur}`);
    }

    barTokens.push(tokens.join(" "));
  }

  // On groupe 4 mesures par ligne pour la lisibilité
  const lines2: string[] = [];
  for (let i = 0; i < barTokens.length; i += 4) {
    const chunk = barTokens.slice(i, i + 4);
    lines2.push(chunk.join(" | ") + " |");
  }

  return [...lines, ...lines2].join("\n");
}
