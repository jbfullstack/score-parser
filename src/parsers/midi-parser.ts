// ============================================================
// MIDI Parser — .mid / .midi
// Utilise @tonejs/midi pour le parsing bas niveau.
// ============================================================
// Les fichiers MIDI sont toujours en concert pitch.
// Guitar Pro exporte son MIDI en concert pitch aussi.
// Si ton fichier vient d'un autre outil en pitch écrit,
// applique la transposition manuellement après parsing.
// ============================================================

import { Midi } from "@tonejs/midi";
import type {
  ParsedScore,
  ParsedTrack,
  ParsedNote,
  ParsedTempoChange,
  ParsedTimeSigChange,
} from "../types.js";
import { detectSaxTrack } from "../types.js";

export interface MidiParseOptions {
  /** Forcer une valeur PPQ (défaut: valeur du fichier ou 480) */
  ppqOverride?: number;
}

export function parseMidi(
  fileBuffer: Buffer | Uint8Array,
  options: MidiParseOptions = {}
): ParsedScore {
  const midi = new Midi(fileBuffer instanceof Buffer ? fileBuffer : Buffer.from(fileBuffer));
  const ppq = options.ppqOverride ?? (midi.header.ppq || 480);

  // ── Tempos ───────────────────────────────────────────────
  // Math.round(t.bpm) perd les tempos fractionnaires (ex: 92.5 BPM).
  // On conserve 2 décimales max — assez précis, sans bruit de flottant.
  const tempos: ParsedTempoChange[] = midi.header.tempos.map((t) => ({
    tick: t.ticks,
    bpm:  Math.round(t.bpm * 100) / 100,
  }));
  if (tempos.length === 0) tempos.push({ tick: 0, bpm: 120 });

  // ── Time signatures ──────────────────────────────────────
  const timeSigs: ParsedTimeSigChange[] = midi.header.timeSignatures
  .filter((ts) => ts.timeSignature[0] !== undefined && ts.timeSignature[1] !== undefined)
  .map((ts) => ({
    tick:        ts.ticks,
    numerator:   ts.timeSignature[0]!,
    denominator: ts.timeSignature[1]!,
  }));
  if (timeSigs.length === 0) timeSigs.push({ tick: 0, numerator: 4, denominator: 4 });

  // ── Tracks ───────────────────────────────────────────────
  const parsedTracks: ParsedTrack[] = midi.tracks.map((track, idx) => {
    const name        = track.name || `Track ${idx + 1}`;
    const midiProgram = track.instrument.number ?? 0;
    const midiChannel = track.channel ?? 0;

    const notes: ParsedNote[] = track.notes
      // @tonejs/midi peut retourner NaN pour ticks si un deltaTime est absent.
      // NaN n'est pas nullish → utiliser Number.isFinite(), pas `?? 0`.
      .filter((n) => Number.isFinite(n.ticks))
      .map((n) => ({
        pitchMidi:     n.midi ?? 60,
        startTick:     n.ticks,
        durationTicks: Number.isFinite(n.durationTicks) && n.durationTicks >= 0
          ? n.durationTicks
          : ppq,   // fallback: une noire
        velocity:      Math.round((n.velocity ?? 0.8) * 127),
        isRest:        false,
      }));

    return {
      id:          idx,
      name,
      midiProgram,
      midiChannel,
      notes,
      isSaxophone: detectSaxTrack({ name, midiProgram }),
    };
  });

  return {
    title:        midi.header.name || "",
    artist:       "",
    composer:     "",
    ppq,
    tracks:       parsedTracks,
    tempos,
    timeSigs,
    keySigs:      [],   // Le format MIDI standard n'expose pas les armures via @tonejs/midi
    sourceFormat: "midi",
  };
}
