// ============================================================
// Guitar Pro Parser — .gp3, .gp4, .gp5, .gpx, .gp
// Utilise @coderline/alphatab côté serveur.
// ============================================================
// alphaTab stocke les hauteurs en "pitch écrit" (displayed pitch).
// Pour les instruments transpositeurs, on applique la correction
// written → concert pitch avant de pousser dans ParsedNote.
//
// beat.duration : enum Duration (entier), PAS un objet.
//   Whole=1, Half=2, Quarter=4, Eighth=8, Sixteenth=16, 32nd=32, 64th=64
//   DoubleWhole=-2, QuadrupleWhole=-4
// beat.dots : nombre de points (0, 1, 2)
// ============================================================

import * as at from "@coderline/alphatab";
import type {
  ParsedScore,
  ParsedTrack,
  ParsedNote,
  ParsedTempoChange,
  ParsedTimeSigChange,
  ParsedKeySigChange,
} from "../types.js";
import { detectSaxTrack } from "../types.js";

// ── Interfaces structurelles ──────────────────────────────────
// alphaTab expose ses classes internes via `declare class` (non-exporté),
// ce qui les rend inaccessibles en tant que types via `at.MasterBar` etc.
// On définit ici les sous-ensembles de propriétés dont on a besoin.

/** Sous-ensemble de MasterBar utilisé dans buildExpandedBars */
export interface MasterBarLike {
  timeSignatureNumerator:   number;
  timeSignatureDenominator: number;
  isRepeatStart:            boolean;
  isRepeatEnd:              boolean;
  repeatCount:              number | undefined;
  tempoAutomations?:        ReadonlyArray<{ value: number }>;
  keySignature?:            number;
  keySignatureType?:        number;
}

/** Sous-ensemble de Note utilisé dans la collecte d'annotations */
interface NoteLike {
  isBend?:          boolean;
  isVibrato?:       boolean;
  isHammerOn?:      boolean;
  isPullOff?:       boolean;
  isSlide?:         boolean;
  isTremoloPicking?: boolean;
}

/** Sous-ensemble de Beat pour les effets de niveau beat */
interface BeatLike {
  vibrato?: unknown;
  tap?:     boolean;
}

export const PPQ = 480;

/** Transposition written → concert pitch, par programme MIDI GM (demi-tons).
 *  Instruments non-transpositeurs (piano, guitare, basse…) → 0. */
export const TRANSPOSITION_BY_PROGRAM: Readonly<Record<number, number>> = {
  64: -2,   // Soprano Sax (Sib)
  65: -9,   // Alto Sax (Mib)
  66: -14,  // Tenor Sax (Sib, octave grave)
  67: -21,  // Baritone Sax (Mib, octave grave)
  71: -2,   // Clarinet (Sib)
  56: -2,   // Trumpet (Sib)
  57: 0,    // Trombone (non transpositeur en notation)
  60: -7,   // French Horn (Fa) — conventionnellement
};

/** DynamicValue enum alphaTab (0–7) → MIDI velocity (0–127).
 *  PPP=0, PP=1, P=2, MP=3, MF=4 (défaut GP), F=5, FF=6, FFF=7. */
export const DYNAMIC_VELOCITY: Readonly<Record<number, number>> = {
  0: 15, 1: 30, 2: 45, 3: 60, 4: 80, 5: 96, 6: 112, 7: 127,
};

export function dynamicToVelocity(dv: number | undefined | null): number {
  if (dv == null) return 80;          // MF par défaut (Guitar Pro défaut)
  return DYNAMIC_VELOCITY[dv] ?? 80;
}

// beat.duration (enum int) + dots → ticks (PPQ=480)
export function alphaTabDurationToTicks(durationValue: number, dots: number): number {
  // Valeurs positives (>=1) : PPQ * 4 / value  → Quarter=480, Half=960, Whole=1920
  // Valeurs négatives (brèves) : PPQ * 4 * |value| → DoubleWhole=3840
  const base = durationValue >= 1
    ? (PPQ * 4) / durationValue
    : (PPQ * 4) * Math.abs(durationValue);
  if (dots >= 2) return base * 1.75;
  if (dots >= 1) return base * 1.5;
  return base;
}

// ── Gestion des répétitions ───────────────────────────────────

interface ExpandedBar {
  masterBarIdx: number;
  startTick:    number;
  barTicks:     number;
}

/**
 * Déplie les répétitions Guitar Pro en une séquence linéaire de mesures.
 *
 * Algorithme stack-based :
 * - isRepeatStart → mémorise l'index de début de section
 * - isRepeatEnd   → rejoue la section (repeatCount - 1) fois supplémentaires
 *
 * Les reprises imbriquées sont supportées via une pile.
 */
export function buildExpandedBars(masterBars: MasterBarLike[]): ExpandedBar[] {
  const result: ExpandedBar[] = [];
  const repeatOpenStack: number[] = [];   // indices dans masterBars
  let currentTick = 0;

  for (let i = 0; i < masterBars.length; i++) {
    const mb = masterBars[i];
    if (!mb) continue;

    if (mb.isRepeatStart) {
      repeatOpenStack.push(i);
    }

    const num  = mb.timeSignatureNumerator;
    const den  = mb.timeSignatureDenominator;
    const barTicks = (PPQ * 4 * num) / den;

    result.push({ masterBarIdx: i, startTick: currentTick, barTicks });
    currentTick += barTicks;

    if (mb.isRepeatEnd) {
      // startIdx = premier masterBar de la section répétée
      const startIdx = repeatOpenStack.length > 0 ? repeatOpenStack.pop()! : 0;
      // repeatCount = nombre total de lectures (y compris la première)
      const totalPlays = Math.max(2, mb.repeatCount ?? 2);

      for (let rep = 1; rep < totalPlays; rep++) {
        for (let j = startIdx; j <= i; j++) {
          const mb2 = masterBars[j];
          if (!mb2) continue;
          const num2  = mb2.timeSignatureNumerator;
          const den2  = mb2.timeSignatureDenominator;
          const bt2   = (PPQ * 4 * num2) / den2;
          result.push({ masterBarIdx: j, startTick: currentTick, barTicks: bt2 });
          currentTick += bt2;
        }
      }
    }
  }

  return result;
}

// ── Annotations ornements guitare ────────────────────────────

function collectNoteAnnotations(note: NoteLike, beat: BeatLike): string[] | undefined {
  const ann: string[] = [];
  if (note.isBend)           ann.push("bend");
  if (note.isVibrato)        ann.push("vibrato");
  if (note.isHammerOn)       ann.push("hammer-on");
  if (note.isPullOff)        ann.push("pull-off");
  if (note.isSlide)          ann.push("slide");
  if (note.isTremoloPicking) ann.push("tremolo-picking");
  if (beat.tap)              ann.push("tap");
  if (beat.vibrato)          ann.push("beat-vibrato");
  return ann.length > 0 ? ann : undefined;
}

// ── Options ──────────────────────────────────────────────────

export interface GpParseOptions {
  /**
   * Dérouler les répétitions Guitar Pro en une séquence linéaire.
   * @default true
   */
  expandRepeats?: boolean;
}

// ── Parser principal ─────────────────────────────────────────

export async function parseGuitarPro(
  fileBuffer: Buffer | Uint8Array,
  options: GpParseOptions = {}
): Promise<ParsedScore> {
  const { expandRepeats = true } = options;

  const settings = new at.Settings();
  const score = at.importer.ScoreLoader.loadScoreFromBytes(
    fileBuffer instanceof Uint8Array ? fileBuffer : new Uint8Array(fileBuffer),
    settings
  );

  const masterBars = score.masterBars;

  // ── Séquence de mesures (avec ou sans déroulement des répétitions) ──
  const expandedBars = expandRepeats
    ? buildExpandedBars(masterBars)
    : masterBars.map((mb, i) => {
        const num  = mb.timeSignatureNumerator;
        const den  = mb.timeSignatureDenominator;
        let  tick  = 0;
        for (let j = 0; j < i; j++) {
          const prev = masterBars[j]!;
          tick += (PPQ * 4 * prev.timeSignatureNumerator) / prev.timeSignatureDenominator;
        }
        return { masterBarIdx: i, startTick: tick, barTicks: (PPQ * 4 * num) / den };
      });

  // ── Tempos ───────────────────────────────────────────────
  // Les tempos sont attachés aux masterBars (pas aux expanded bars) —
  // mais leur position tick doit refléter la séquence déroulée.
  const tempos: ParsedTempoChange[] = [];
  for (const eb of expandedBars) {
    const mb = masterBars[eb.masterBarIdx]!;
    if (mb.tempoAutomations?.length > 0) {
      for (const auto of mb.tempoAutomations) {
        tempos.push({ tick: eb.startTick, bpm: auto.value });
      }
    }
  }
  if (tempos.length === 0) {
    tempos.push({ tick: 0, bpm: score.tempo ?? 120 });
  }

  // ── Time signatures ──────────────────────────────────────
  // Dédupliquées : on n'émet une entrée que si la métrique change.
  const timeSigs: ParsedTimeSigChange[] = [];
  let lastNum = -1, lastDen = -1;
  for (const eb of expandedBars) {
    const mb  = masterBars[eb.masterBarIdx]!;
    const num = mb.timeSignatureNumerator;
    const den = mb.timeSignatureDenominator;
    if (num !== lastNum || den !== lastDen) {
      timeSigs.push({ tick: eb.startTick, numerator: num, denominator: den });
      lastNum = num; lastDen = den;
    }
  }
  if (timeSigs.length === 0) timeSigs.push({ tick: 0, numerator: 4, denominator: 4 });

  // ── Key signatures ───────────────────────────────────────
  // masterBar.keySignature : -7 à +7 (bémols → dièses)
  // masterBar.keySignatureType : 0 = major, 1 = minor
  const keySigs: ParsedKeySigChange[] = [];
  let lastFifths = NaN, lastMode = "";
  for (const eb of expandedBars) {
    const mb     = masterBars[eb.masterBarIdx]!;
    const fifths = mb.keySignature as number ?? 0;
    const mode   = (mb.keySignatureType as number) === 1 ? "minor" : "major";
    if (fifths !== lastFifths || mode !== lastMode) {
      keySigs.push({ tick: eb.startTick, fifths, mode });
      lastFifths = fifths; lastMode = mode;
    }
  }
  if (keySigs.length === 0) keySigs.push({ tick: 0, fifths: 0, mode: "major" });

  // ── Tracks ───────────────────────────────────────────────
  const parsedTracks: ParsedTrack[] = [];

  for (const track of score.tracks) {
    const midiProgram: number = track.playbackInfo?.program ?? 0;
    const midiChannel: number = track.playbackInfo?.primaryChannel ?? 0;
    const name: string        = track.name || `Track ${track.index + 1}`;
    const transposition       = TRANSPOSITION_BY_PROGRAM[midiProgram] ?? 0;

    const notes: ParsedNote[] = [];

    // Un track peut avoir plusieurs staves (ex: piano grand staff).
    // On traite le premier staff uniquement — convention saxophone.
    const staff = track.staves[0];
    if (!staff) {
      parsedTracks.push({
        id: track.index, name, midiProgram, midiChannel, notes,
        isSaxophone: detectSaxTrack({ name, midiProgram }),
      });
      continue;
    }

    // Construire une map barIndex → Bar pour accès O(1)
    // Le type est inféré depuis staff.bars (typé par alphaTab via ScoreLoader)
    const barByIndex = new Map<number, (typeof staff.bars)[number]>();
    for (const bar of staff.bars) {
      barByIndex.set(bar.index, bar);
    }

    for (const eb of expandedBars) {
      const bar = barByIndex.get(eb.masterBarIdx);
      if (!bar) continue;

      for (const voice of bar.voices) {
        if (voice.isEmpty) continue;

        let beatTickInBar = 0;
        for (const beat of voice.beats) {
          const durationTicks = alphaTabDurationToTicks(beat.duration, beat.dots ?? 0);

          if (!beat.isRest) {
            const actualDuration = beat.hasTuplet
              ? Math.round(durationTicks * beat.tupletDenominator / beat.tupletNumerator)
              : Math.round(durationTicks);

            for (const note of beat.notes) {
              if (note.isDead) continue;

              const writtenMidi = note.displayValue ?? note.realValue ?? 60;
              const concertMidi = writtenMidi + transposition;

              // Liaison : prolonge la note précédente de même pitch
              if (note.isTieDestination) {
                for (let i = notes.length - 1; i >= 0; i--) {
                  if (notes[i]!.pitchMidi === concertMidi) {
                    notes[i]!.durationTicks += actualDuration;
                    break;
                  }
                }
                continue;
              }

              const velocity = note.isGhost ? 30 : dynamicToVelocity(note.dynamics);
              const annotations = collectNoteAnnotations(note as NoteLike, beat as BeatLike);

              const parsed: ParsedNote = {
                pitchMidi:     concertMidi,
                startTick:     eb.startTick + beatTickInBar,
                durationTicks: actualDuration,
                velocity,
                isRest:        false,
              };
              if (annotations) parsed.annotations = annotations;
              notes.push(parsed);
            }
          }

          beatTickInBar += durationTicks;
        }
      }
    }

    parsedTracks.push({
      id:          track.index,
      name,
      midiProgram,
      midiChannel,
      notes,
      isSaxophone: detectSaxTrack({ name, midiProgram }),
    });
  }

  // Déduire le format source depuis le nom de fichier est impossible ici —
  // on retourne "gpx" comme format générique pour tous les formats GP.
  return {
    title:        score.title    || "",
    artist:       score.artist   || "",
    composer:     score.words    || score.music || "",
    ppq:          PPQ,
    tracks:       parsedTracks,
    tempos,
    timeSigs,
    keySigs,
    sourceFormat: "gpx",
  };
}
