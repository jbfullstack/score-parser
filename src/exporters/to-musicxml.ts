// ============================================================
// Exporter MusicXML v4.0
// ============================================================
// Format universel : Sibelius, Finale, MuseScore, Dorico.
// On génère un score-partwise minimal mais valide.
//
// Ce que cette v1 gère :
//   pitch, duration, rests, time signature, key signature, tempo
// Ce que cette v1 ne gère pas (limitatons documentées) :
//   ornements (bend, vibrato), paroles, multi-voix complexes
// ============================================================

import type {
  ParsedScore,
  ParsedNote,
  ParsedTimeSigChange,
  ParsedKeySigChange,
  ParsedTempoChange,
} from "../types.js";

// ── Utilitaires pitch ─────────────────────────────────────────

// Classe de hauteur → step + alter (en sharps)
const PITCH_CLASS: ReadonlyArray<{ step: string; alter: number }> = [
  { step: "C", alter: 0 },   // 0
  { step: "C", alter: 1 },   // 1  C#
  { step: "D", alter: 0 },   // 2
  { step: "D", alter: 1 },   // 3  D#
  { step: "E", alter: 0 },   // 4
  { step: "F", alter: 0 },   // 5
  { step: "F", alter: 1 },   // 6  F#
  { step: "G", alter: 0 },   // 7
  { step: "G", alter: 1 },   // 8  G#
  { step: "A", alter: 0 },   // 9
  { step: "A", alter: 1 },   // 10 A#
  { step: "B", alter: 0 },   // 11
];

function midiToPitch(midi: number): { step: string; alter: number; octave: number } {
  const pc = ((midi % 12) + 12) % 12;
  const { step, alter } = PITCH_CLASS[pc]!;
  const octave = Math.floor(midi / 12) - 1;
  return { step, alter, octave };
}

// ── Utilitaires durée ─────────────────────────────────────────

interface NoteType { type: string; dots: number }

function ticksToNoteType(ticks: number, ppq: number): NoteType {
  const whole = ppq * 4;
  const candidates: Array<[number, string]> = [
    [whole,        "whole"],
    [whole / 2,    "half"],
    [whole / 4,    "quarter"],
    [whole / 8,    "eighth"],
    [whole / 16,   "16th"],
    [whole / 32,   "32nd"],
    [whole / 64,   "64th"],
  ];
  const TOLERANCE = 2; // ticks
  for (const [base, type] of candidates) {
    if (Math.abs(ticks - base * 1.75) <= TOLERANCE) return { type, dots: 2 };
    if (Math.abs(ticks - base * 1.5)  <= TOLERANCE) return { type, dots: 1 };
    if (Math.abs(ticks - base)         <= TOLERANCE) return { type, dots: 0 };
  }
  return { type: "quarter", dots: 0 }; // fallback raisonnable
}

// ── Construction des mesures ──────────────────────────────────

interface Measure {
  number:   number;
  startTick: number;
  endTick:   number;
  timeSig:  ParsedTimeSigChange;
  keySig?:  ParsedKeySigChange;
  tempo?:   ParsedTempoChange;
  notes:    ParsedNote[];
}

function buildMeasures(
  notes: ParsedNote[],
  timeSigs: ParsedTimeSigChange[],
  keySigs: ParsedKeySigChange[],
  tempos: ParsedTempoChange[],
  ppq: number,
): Measure[] {
  // Toujours émettre au moins une mesure, même sans notes,
  // afin que les attributs (armure, métrique) apparaissent dans le XML.
  if (notes.length === 0) {
    const sig = timeSigs[0] ?? { tick: 0, numerator: 4, denominator: 4 };
    const empty: Measure = {
      number:    1,
      startTick: 0,
      endTick:   (ppq * 4 * sig.numerator) / sig.denominator,
      timeSig:   sig,
      notes:     [],
    };
    if (keySigs[0]) empty.keySig = keySigs[0];
    if (tempos[0])  empty.tempo  = tempos[0];
    return [empty];
  }

  const totalTicks = Math.max(...notes.map((n) => n.startTick + n.durationTicks));
  const measures: Measure[] = [];

  let tick = 0;
  let measureNum = 1;
  let sigIdx = 0;

  while (tick < totalTicks) {
    // Avancer l'index de métrique si besoin
    while (sigIdx + 1 < timeSigs.length && (timeSigs[sigIdx + 1]?.tick ?? Infinity) <= tick) {
      sigIdx++;
    }
    const sig = timeSigs[sigIdx] ?? { tick: 0, numerator: 4, denominator: 4 };
    const barTicks = (ppq * 4 * sig.numerator) / sig.denominator;

    const barEnd = tick + barTicks;

    // Key sig active à ce tick
    const keySig = [...keySigs].reverse().find((k) => k.tick <= tick);
    // Tempo actif à ce tick
    const tempo  = [...tempos].reverse().find((t) => t.tick <= tick);

    // Notes dans cette mesure
    const barNotes = notes.filter(
      (n) => n.startTick >= tick && n.startTick < barEnd
    );

    // Pour la première mesure, ou si la métrique/armure/tempo change, on l'émet
    const prevMeasure = measures[measures.length - 1];
    measures.push({
      number:    measureNum++,
      startTick: tick,
      endTick:   barEnd,
      timeSig:   sig,
      notes:     barNotes,
      ...(( measureNum === 2 || keySig?.tick === tick) && keySig ? { keySig } : {}),
      ...((measureNum === 2 || tempo?.tick  === tick)  && tempo  ? { tempo  } : {}),
    });

    tick = barEnd;
  }

  return measures;
}

// ── XML helpers ───────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function tag(name: string, content: string, attrs: Record<string, string | number> = {}): string {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
    .join("");
  return `<${name}${attrStr}>${content}</${name}>`;
}

// ── Export principal ──────────────────────────────────────────

/**
 * Convertit un ParsedScore en MusicXML v4.0 (score-partwise).
 *
 * @param score       - Résultat du parseur
 * @param trackIndex  - Index du track à exporter (défaut: premier track)
 * @returns String XML valide
 */
export function scoreToMusicXML(score: ParsedScore, trackIndex = 0): string {
  const track = score.tracks[trackIndex];
  if (!track) throw new Error(`Track ${trackIndex} not found in score (${score.tracks.length} tracks).`);

  const measures = buildMeasures(
    track.notes,
    score.timeSigs,
    score.keySigs,
    score.tempos,
    score.ppq,
  );

  const partId = "P1";
  const lines: string[] = [];

  // ── Prologue ──
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">`);
  lines.push(`<score-partwise version="4.0">`);

  // ── Work / Identification ──
  if (score.title) {
    lines.push(`  <work>${tag("work-title", esc(score.title))}</work>`);
  }
  if (score.composer || score.artist) {
    lines.push(`  <identification>`);
    if (score.composer) lines.push(`    ${tag("creator", esc(score.composer), { type: "composer" })}`);
    if (score.artist)   lines.push(`    ${tag("creator", esc(score.artist),   { type: "lyricist" })}`);
    lines.push(`  </identification>`);
  }

  // ── Part list ──
  lines.push(`  <part-list>`);
  lines.push(`    <score-part id="${partId}">`);
  lines.push(`      ${tag("part-name", esc(track.name))}`);
  lines.push(`    </score-part>`);
  lines.push(`  </part-list>`);

  // ── Part ──
  lines.push(`  <part id="${partId}">`);

  for (const measure of measures) {
    lines.push(`    <measure number="${measure.number}">`);

    // Attributes (1ère mesure ou changement)
    if (measure.number === 1 || measure.timeSig.tick === measure.startTick ||
        measure.keySig?.tick === measure.startTick) {
      lines.push(`      <attributes>`);
      lines.push(`        ${tag("divisions", String(score.ppq))}`);

      // Key signature
      const ks = measure.keySig ?? { fifths: 0, mode: "major" as const };
      lines.push(`        <key>${tag("fifths", String(ks.fifths))}${tag("mode", ks.mode)}</key>`);

      // Time signature
      const { numerator, denominator } = measure.timeSig;
      lines.push(`        <time>${tag("beats", String(numerator))}${tag("beat-type", String(denominator))}</time>`);

      if (measure.number === 1) {
        // Clé de sol par défaut — à overrider si alto sax écrit en clé de sol octave basse
        lines.push(`        <clef>${tag("sign", "G")}${tag("line", "2")}</clef>`);
      }
      lines.push(`      </attributes>`);
    }

    // Tempo (direction)
    if (measure.tempo) {
      const bpm = measure.tempo.bpm;
      lines.push(`      <direction placement="above">`);
      lines.push(`        <direction-type>`);
      lines.push(`          <metronome>${tag("beat-unit", "quarter")}${tag("per-minute", String(bpm))}</metronome>`);
      lines.push(`        </direction-type>`);
      lines.push(`        ${tag("sound", "", { tempo: String(bpm) })}`);
      lines.push(`      </direction>`);
    }

    // Notes + rests
    // On reconstruit les silences pour remplir la mesure
    const barNotes = [...measure.notes].sort((a, b) => a.startTick - b.startTick);
    let cursor = measure.startTick;

    const emitNote = (note: ParsedNote | null, startTick: number, durationTicks: number) => {
      const { type, dots } = ticksToNoteType(durationTicks, score.ppq);
      lines.push(`      <note>`);
      if (note === null || note.isRest) {
        lines.push(`        <rest/>`);
      } else {
        const { step, alter, octave } = midiToPitch(note.pitchMidi);
        lines.push(`        <pitch>`);
        lines.push(`          ${tag("step", step)}`);
        if (alter !== 0) lines.push(`          ${tag("alter", String(alter))}`);
        lines.push(`          ${tag("octave", String(octave))}`);
        lines.push(`        </pitch>`);
      }
      lines.push(`        ${tag("duration", String(Math.round(durationTicks)))}`);
      lines.push(`        ${tag("type", type)}`);
      for (let d = 0; d < dots; d++) lines.push(`        <dot/>`);
      lines.push(`      </note>`);
    };

    for (const note of barNotes) {
      // Silence avant la note si nécessaire
      if (note.startTick > cursor) {
        emitNote(null, cursor, note.startTick - cursor);
      }
      emitNote(note, note.startTick, note.durationTicks);
      cursor = note.startTick + note.durationTicks;
    }

    // Silence final de mesure
    if (cursor < measure.endTick) {
      emitNote(null, cursor, measure.endTick - cursor);
    }

    lines.push(`    </measure>`);
  }

  lines.push(`  </part>`);
  lines.push(`</score-partwise>`);

  return lines.join("\n");
}
