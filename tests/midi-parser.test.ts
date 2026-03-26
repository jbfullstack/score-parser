import { describe, it, expect } from "vitest";
import { parseMidi } from "../src/parsers/midi-parser.js";
import { detectSaxTrack, SAX_MIDI_PROGRAMS } from "../src/types.js";

// ═══════════════════════════════════════════════════════════════
// Helpers — construction de buffers MIDI valides en mémoire
// ═══════════════════════════════════════════════════════════════
//
// Format binaire MIDI :
//   MThd  : magic(4) + length(4=6) + format(2) + nTracks(2) + ppq(2)
//   MTrk  : magic(4) + length(4) + events[]
//   Event : deltaTime(varint) + status + data

/** Encode un entier en variable-length quantity (MIDI varint) */
function varInt(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  while (n > 0) {
    bytes.unshift(n & 0x7F);
    n >>>= 7;
  }
  for (let i = 0; i < bytes.length - 1; i++) bytes[i]! |= 0x80;
  return bytes;
}

function uint32BE(n: number): [number, number, number, number] {
  return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF];
}
function uint16BE(n: number): [number, number] {
  return [(n >>> 8) & 0xFF, n & 0xFF];
}

/** En-tête MIDI (14 octets : MThd + 6 + format + nTracks + ppq) */
function midiHeader(format: 0 | 1, nTracks: number, ppq: number): Buffer {
  return Buffer.from([
    0x4D, 0x54, 0x68, 0x64,   // "MThd"
    ...uint32BE(6),            // chunk length = 6
    ...uint16BE(format),
    ...uint16BE(nTracks),
    ...uint16BE(ppq),
  ]);
}

/** Construit un chunk MTrk depuis un tableau d'octets d'événements */
function midiTrack(events: number[]): Buffer {
  return Buffer.from([
    0x4D, 0x54, 0x72, 0x6B,   // "MTrk"
    ...uint32BE(events.length),
    ...events,
  ]);
}

function endOfTrack(): number[] {
  return [0x00, 0xFF, 0x2F, 0x00];
}

function setTempo(bpm: number): number[] {
  const us = Math.round(60_000_000 / bpm);
  return [
    0x00, 0xFF, 0x51, 0x03,
    (us >>> 16) & 0xFF, (us >>> 8) & 0xFF, us & 0xFF,
  ];
}

function timeSig(num: number, denExp: number /* 2^n */): number[] {
  // Meta 0x58 : numerator, log2(denominator), MIDI clocks/click, 32nd per quarter
  return [0x00, 0xFF, 0x58, 0x04, num, denExp, 24, 8];
}

function programChange(channel: number, program: number): number[] {
  return [0x00, 0xC0 | channel, program];
}

function noteOn(channel: number, note: number, velocity: number, delta = 0): number[] {
  return [...varInt(delta), 0x90 | channel, note, velocity];
}

function noteOff(channel: number, note: number, delta: number): number[] {
  return [...varInt(delta), 0x80 | channel, note, 0];
}

/** MIDI Format 0 avec un seul track complet */
function buildFormat0(
  ppq: number,
  bpm: number,
  notes: Array<{ midi: number; program: number; velocity?: number; durationTicks?: number }>,
): Buffer {
  const dur = ppq; // noire par défaut
  const events: number[] = [
    ...setTempo(bpm),
    ...timeSig(4, 2),
  ];
  for (const n of notes) {
    if (n.program !== undefined) events.push(...programChange(0, n.program));
    events.push(...noteOn(0, n.midi, n.velocity ?? 80));
    events.push(...noteOff(0, n.midi, n.durationTicks ?? dur));
  }
  events.push(...endOfTrack());
  return Buffer.concat([midiHeader(0, 1, ppq), midiTrack(events)]);
}

/** MIDI Format 1 : track 0 = tempo/timesig, track 1+ = notes */
function buildFormat1(
  ppq: number,
  tempos: Array<{ bpm: number }>,
  tracks: Array<{ program: number; notes: Array<{ midi: number; velocity?: number; durationTicks?: number }> }>,
): Buffer {
  const tempoTrack: number[] = [];
  for (const t of tempos) tempoTrack.push(...setTempo(t.bpm));
  tempoTrack.push(...endOfTrack());

  const noteChunks = tracks.map((t) => {
    const ev: number[] = [...programChange(0, t.program)];
    for (const n of t.notes) {
      ev.push(...noteOn(0, n.midi, n.velocity ?? 80));
      ev.push(...noteOff(0, n.midi, n.durationTicks ?? ppq));
    }
    ev.push(...endOfTrack());
    return midiTrack(ev);
  });

  return Buffer.concat([
    midiHeader(1, 1 + tracks.length, ppq),
    midiTrack(tempoTrack),
    ...noteChunks,
  ]);
}

// ═══════════════════════════════════════════════════════════════
// Tests parseMidi
// ═══════════════════════════════════════════════════════════════

describe("parseMidi — PPQ & fallbacks", () => {
  it("préserve le PPQ du fichier (480)", () => {
    expect(parseMidi(buildFormat0(480, 120, [])).ppq).toBe(480);
  });

  it("préserve le PPQ du fichier (960)", () => {
    expect(parseMidi(buildFormat0(960, 120, [])).ppq).toBe(960);
  });

  it("retourne 480 si PPQ=0 dans le fichier (fallback)", () => {
    // PPQ=0 est invalide → @tonejs/midi le retourne 0 → on force 480
    const buf = buildFormat0(0, 120, []);
    expect(parseMidi(buf).ppq).toBe(480);
  });

  it("ppqOverride écrase la valeur du fichier", () => {
    const buf = buildFormat0(960, 120, []);
    expect(parseMidi(buf, { ppqOverride: 480 }).ppq).toBe(480);
  });

  it("retourne un tempo 120 par défaut si le fichier n'en a pas", () => {
    // Track sans set_tempo
    const events = [...endOfTrack()];
    const buf = Buffer.concat([midiHeader(0, 1, 480), midiTrack(events)]);
    const score = parseMidi(buf);
    expect(score.tempos.length).toBeGreaterThan(0);
    expect(score.tempos[0]!.bpm).toBe(120);
  });

  it("retourne 4/4 par défaut si aucune time signature", () => {
    const events = [...setTempo(120), ...endOfTrack()];
    const buf = Buffer.concat([midiHeader(0, 1, 480), midiTrack(events)]);
    const score = parseMidi(buf);
    expect(score.timeSigs[0]).toMatchObject({ numerator: 4, denominator: 4, tick: 0 });
  });

  it("sourceFormat est 'midi'", () => {
    expect(parseMidi(buildFormat0(480, 120, [])).sourceFormat).toBe("midi");
  });
});

describe("parseMidi — précision BPM", () => {
  it("BPM entier conservé exact (120)", () => {
    const score = parseMidi(buildFormat0(480, 120, []));
    expect(score.tempos[0]!.bpm).toBe(120);
  });

  it("BPM fractionnaire arrondi à 2 décimales (92.5)", () => {
    const score = parseMidi(buildFormat0(480, 92.5, []));
    // L'encodage µs/beat introduit une légère imprécision
    expect(score.tempos[0]!.bpm).toBeCloseTo(92.5, 1);
  });

  it("BPM fractionnaire arrondi à 2 décimales (138.57)", () => {
    const score = parseMidi(buildFormat0(480, 138.57, []));
    expect(score.tempos[0]!.bpm).toBeCloseTo(138.57, 1);
  });

  it("ne stocke PAS Math.round() brut qui tronquerait 92.5→93", () => {
    const score = parseMidi(buildFormat0(480, 92.5, []));
    // Si on avait Math.round(), on aurait 93. On doit avoir ~92.5.
    expect(score.tempos[0]!.bpm).toBeLessThan(93);
  });
});

describe("parseMidi — notes", () => {
  it("parse une note : pitchMidi correct (concert pitch = valeur brute)", () => {
    const score = parseMidi(buildFormat0(480, 120, [{ midi: 65, program: 65 }]));
    const note = score.tracks[0]?.notes[0];
    expect(note?.pitchMidi).toBe(65);   // MIDI n'applique aucune transposition
  });

  it("parse une note : startTick = 0 pour la première note", () => {
    const score = parseMidi(buildFormat0(480, 120, [{ midi: 60, program: 0 }]));
    expect(score.tracks[0]?.notes[0]?.startTick).toBe(0);
  });

  it("parse une note : durationTicks = ppq pour une noire", () => {
    const score = parseMidi(buildFormat0(480, 120, [{ midi: 60, program: 0, durationTicks: 480 }]));
    expect(score.tracks[0]?.notes[0]?.durationTicks).toBe(480);
  });

  it("velocity convertie correctement (80/127 normalisé → 80)", () => {
    const score = parseMidi(buildFormat0(480, 120, [{ midi: 60, program: 0, velocity: 80 }]));
    // @tonejs/midi normalise 80→80/127; on remultiplie par 127 → 80
    expect(score.tracks[0]?.notes[0]?.velocity).toBe(80);
  });

  it("velocity faible conservée (30 PP)", () => {
    const score = parseMidi(buildFormat0(480, 120, [{ midi: 60, program: 0, velocity: 30 }]));
    expect(score.tracks[0]?.notes[0]?.velocity).toBe(30);
  });

  it("parse plusieurs notes dans le bon ordre", () => {
    const buf = buildFormat0(480, 120, [
      { midi: 60, program: 0 },
      { midi: 62, program: 0 },
      { midi: 64, program: 0 },
    ]);
    const notes = parseMidi(buf).tracks[0]?.notes ?? [];
    expect(notes.length).toBe(3);
    expect(notes[0]!.pitchMidi).toBe(60);
    expect(notes[1]!.pitchMidi).toBe(62);
    expect(notes[2]!.pitchMidi).toBe(64);
  });

  it("notes séquentielles : startTick incrémente correctement", () => {
    const buf = buildFormat0(480, 120, [
      { midi: 60, program: 0, durationTicks: 480 },
      { midi: 62, program: 0, durationTicks: 480 },
    ]);
    const notes = parseMidi(buf).tracks[0]?.notes ?? [];
    expect(notes[0]!.startTick).toBe(0);
    expect(notes[1]!.startTick).toBe(480);
  });

  it("accepte un Uint8Array en entrée", () => {
    const buf = buildFormat0(480, 120, [{ midi: 60, program: 0 }]);
    const score = parseMidi(new Uint8Array(buf));
    expect(score.tracks[0]?.notes.length).toBeGreaterThan(0);
  });
});

describe("parseMidi — multi-tracks", () => {
  it("parse 2 tracks distincts", () => {
    const buf = buildFormat1(480, [{ bpm: 120 }], [
      { program: 65, notes: [{ midi: 65 }] },   // Alto Sax
      { program: 0,  notes: [{ midi: 60 }] },   // Piano
    ]);
    const score = parseMidi(buf);
    // Format 1 : track 0 = tempo, tracks 1+ = notes → 3 tracks total
    expect(score.tracks.length).toBe(2);
  });

  it("chaque track a son propre programme MIDI", () => {
    const buf = buildFormat1(480, [{ bpm: 120 }], [
      { program: 65, notes: [{ midi: 65 }] },
      { program: 0,  notes: [{ midi: 60 }] },
    ]);
    const score = parseMidi(buf);
    expect(score.tracks[0]?.midiProgram).toBe(65);
    expect(score.tracks[1]?.midiProgram).toBe(0);
  });

  it("track nom fallback : 'Track 1', 'Track 2'…", () => {
    const buf = buildFormat1(480, [{ bpm: 120 }], [
      { program: 0, notes: [] },
    ]);
    const score = parseMidi(buf);
    // Les tracks sans nom reçoivent "Track N"
    expect(score.tracks[0]?.name).toMatch(/Track \d+/);
  });
});

// ═══════════════════════════════════════════════════════════════
// Tests detectSaxTrack
// ═══════════════════════════════════════════════════════════════

describe("detectSaxTrack — détection par programme MIDI", () => {
  it.each([64, 65, 66, 67])(
    "programme %i → saxophone (quel que soit le nom)",
    (prog) => expect(detectSaxTrack({ name: "Guitar", midiProgram: prog })).toBe(true)
  );

  it.each([0, 24, 25, 40, 56, 71, 73])(
    "programme %i → non-saxophone si le nom ne contient pas 'sax'",
    (prog) => expect(detectSaxTrack({ name: "Lead", midiProgram: prog })).toBe(false)
  );
});

describe("detectSaxTrack — détection par nom", () => {
  const SAX_NAMES = [
    "Alto Sax", "Tenor Saxophone", "sax alto", "Soprano sax",
    "baryton", "baritone sax", "Saxophone Tenor",
  ];
  it.each(SAX_NAMES)("'%s' → saxophone détecté", (name) => {
    expect(detectSaxTrack({ name, midiProgram: 0 })).toBe(true);
  });

  const NON_SAX_NAMES = ["Guitar", "Piano", "Bass", "Violin", "Trumpet", "Drums", ""];
  it.each(NON_SAX_NAMES)("'%s' → non-saxophone", (name) => {
    expect(detectSaxTrack({ name, midiProgram: 0 })).toBe(false);
  });

  it("détection insensible à la casse", () => {
    expect(detectSaxTrack({ name: "ALTO SAX", midiProgram: 0 })).toBe(true);
    expect(detectSaxTrack({ name: "alto sax", midiProgram: 0 })).toBe(true);
  });
});

describe("SAX_MIDI_PROGRAMS", () => {
  it("contient exactement les 4 programmes GM saxophone", () => {
    expect(SAX_MIDI_PROGRAMS.size).toBe(4);
    expect(SAX_MIDI_PROGRAMS.has(64)).toBe(true); // Soprano
    expect(SAX_MIDI_PROGRAMS.has(65)).toBe(true); // Alto
    expect(SAX_MIDI_PROGRAMS.has(66)).toBe(true); // Tenor
    expect(SAX_MIDI_PROGRAMS.has(67)).toBe(true); // Baritone
  });
});
