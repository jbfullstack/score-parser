import { describe, it, expect } from "vitest";
import { scoreToMusicXML } from "../src/exporters/to-musicxml.js";
import type { ParsedScore } from "../src/types.js";

// ── Fixtures ─────────────────────────────────────────────────

function makeScore(
  notes: Array<{ pitchMidi: number; startTick: number; durationTicks: number; isRest?: boolean }>,
  opts: Partial<{ title: string; composer: string; artist: string; ppq: number;
                  fifths: number; mode: "major" | "minor"; bpm: number;
                  timeSig: [number, number] }> = {}
): ParsedScore {
  return {
    title:    opts.title    ?? "Test",
    artist:   opts.artist   ?? "",
    composer: opts.composer ?? "",
    ppq:      opts.ppq      ?? 480,
    sourceFormat: "midi",
    tempos:   [{ tick: 0, bpm: opts.bpm ?? 120 }],
    timeSigs: [{ tick: 0, numerator: opts.timeSig?.[0] ?? 4, denominator: opts.timeSig?.[1] ?? 4 }],
    keySigs:  [{ tick: 0, fifths: opts.fifths ?? 0, mode: opts.mode ?? "major" }],
    tracks: [{
      id: 0, name: "Instrument", midiProgram: 0, midiChannel: 0,
      isSaxophone: false,
      notes: notes.map((n) => ({ ...n, velocity: 80 })),
    }],
  };
}

// ── Tests structure XML ───────────────────────────────────────

describe("scoreToMusicXML — prologue et structure", () => {
  const score = makeScore([{ pitchMidi: 60, startTick: 0, durationTicks: 480 }]);

  it("commence par la déclaration XML", () => {
    expect(scoreToMusicXML(score)).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  });

  it("contient le DOCTYPE MusicXML 4.0", () => {
    expect(scoreToMusicXML(score)).toContain('MusicXML 4.0 Partwise');
  });

  it("balise racine score-partwise version 4.0", () => {
    expect(scoreToMusicXML(score)).toContain('<score-partwise version="4.0">');
  });

  it("contient les divisions (ppq)", () => {
    expect(scoreToMusicXML(score)).toContain("<divisions>480</divisions>");
  });

  it("contient au moins un élément <measure>", () => {
    expect(scoreToMusicXML(score)).toContain("<measure");
  });

  it("contient au moins un élément <note>", () => {
    expect(scoreToMusicXML(score)).toContain("<note>");
  });
});

describe("scoreToMusicXML — métadonnées", () => {
  it("titre dans work-title", () => {
    const xml = scoreToMusicXML(makeScore([], { title: "Autumn Leaves" }));
    expect(xml).toContain("<work-title>Autumn Leaves</work-title>");
  });

  it("compositeur dans creator type='composer'", () => {
    const xml = scoreToMusicXML(makeScore([], { composer: "Joseph Kosma" }));
    expect(xml).toContain('creator type="composer"');
    expect(xml).toContain("Joseph Kosma");
  });

  it("artiste dans creator type='lyricist'", () => {
    const xml = scoreToMusicXML(makeScore([], { artist: "Miles Davis" }));
    expect(xml).toContain('creator type="lyricist"');
    expect(xml).toContain("Miles Davis");
  });

  it("échappement XML : '<' dans le titre devient '&lt;'", () => {
    const xml = scoreToMusicXML(makeScore([], { title: "A<B" }));
    expect(xml).toContain("A&lt;B");
    expect(xml).not.toContain("A<B");
  });

  it("échappement XML : '&' dans le titre devient '&amp;'", () => {
    const xml = scoreToMusicXML(makeScore([], { title: "Salt & Pepper" }));
    expect(xml).toContain("Salt &amp; Pepper");
  });

  it("pas de section <work> si le titre est vide", () => {
    const xml = scoreToMusicXML(makeScore([], { title: "" }));
    expect(xml).not.toContain("<work>");
  });
});

// ── Tests pitch ───────────────────────────────────────────────

describe("scoreToMusicXML — conversion pitch MIDI → MusicXML", () => {
  function pitchXML(midiNote: number): string {
    return scoreToMusicXML(makeScore([{ pitchMidi: midiNote, startTick: 0, durationTicks: 480 }]));
  }

  it.each([
    [60, "C", 0, 4,  "C4 = do central"],
    [62, "D", 0, 4,  "D4"],
    [64, "E", 0, 4,  "E4"],
    [65, "F", 0, 4,  "F4"],
    [67, "G", 0, 4,  "G4"],
    [69, "A", 0, 4,  "A4"],
    [71, "B", 0, 4,  "B4"],
    [72, "C", 0, 5,  "C5 = octave supérieure"],
    [48, "C", 0, 3,  "C3"],
    [59, "B", 0, 3,  "B3"],
    [84, "C", 0, 6,  "C6"],
  ])("MIDI %i → step=%s alter=%i octave=%i (%s)", (midi, step, alter, octave) => {
    const xml = pitchXML(midi);
    expect(xml).toContain(`<step>${step}</step>`);
    expect(xml).toContain(`<octave>${octave}</octave>`);
    if (alter === 0) {
      // La balise <alter> ne doit pas apparaître pour les notes naturelles
      // (on teste que le step ne contient pas d'alter)
      const pitchBlock = xml.match(/<pitch>([\s\S]*?)<\/pitch>/)?.[1] ?? "";
      expect(pitchBlock).not.toContain("<alter>");
    }
  });

  it.each([
    [61, "C", 1, 4,  "C#4"],
    [63, "D", 1, 4,  "D#4"],
    [66, "F", 1, 4,  "F#4"],
    [68, "G", 1, 4,  "G#4"],
    [70, "A", 1, 4,  "A#4 (Bb)"],
  ])("MIDI %i dièse → step=%s alter=%i octave=%i (%s)", (midi, step, alter, octave) => {
    const xml = pitchXML(midi);
    expect(xml).toContain(`<step>${step}</step>`);
    expect(xml).toContain(`<alter>${alter}</alter>`);
    expect(xml).toContain(`<octave>${octave}</octave>`);
  });
});

// ── Tests durées ──────────────────────────────────────────────

describe("scoreToMusicXML — types de notes", () => {
  const PPQ = 480;

  function noteTypeIn(durationTicks: number): string {
    const xml = scoreToMusicXML(makeScore([
      { pitchMidi: 60, startTick: 0, durationTicks },
    ]));
    return xml.match(/<type>(.*?)<\/type>/)?.[1] ?? "";
  }

  it.each([
    [PPQ * 4, "whole"],
    [PPQ * 2, "half"],
    [PPQ,     "quarter"],
    [PPQ / 2, "eighth"],
    [PPQ / 4, "16th"],
    [PPQ / 8, "32nd"],
  ])("%i ticks → type='%s'", (ticks, expected) => {
    expect(noteTypeIn(ticks)).toBe(expected);
  });

  it("noire pointée (720) → type='quarter' + <dot/>", () => {
    const xml = scoreToMusicXML(makeScore([
      { pitchMidi: 60, startTick: 0, durationTicks: 720 },
    ]));
    expect(xml).toContain("<type>quarter</type>");
    expect(xml).toContain("<dot/>");
  });

  it("blanche pointée (1440) → type='half' + <dot/>", () => {
    const xml = scoreToMusicXML(makeScore([
      { pitchMidi: 60, startTick: 0, durationTicks: 1440 },
    ]));
    expect(xml).toContain("<type>half</type>");
    expect(xml).toContain("<dot/>");
  });
});

// ── Tests silences automatiques ───────────────────────────────

describe("scoreToMusicXML — rests automatiques", () => {
  it("gap entre deux notes → silence inséré (<rest/>)", () => {
    // 2 notes avec un silence d'une noire entre elles
    const xml = scoreToMusicXML(makeScore([
      { pitchMidi: 60, startTick: 0,    durationTicks: 480 },
      { pitchMidi: 62, startTick: 960,  durationTicks: 480 },  // gap de 480 ticks
    ]));
    expect(xml).toContain("<rest/>");
  });

  it("note qui ne commence pas à 0 → silence avant la note", () => {
    const xml = scoreToMusicXML(makeScore([
      { pitchMidi: 60, startTick: 480, durationTicks: 480 },
    ]));
    expect(xml).toContain("<rest/>");
  });

  it("track sans notes : retourne du XML sans planter", () => {
    const xml = scoreToMusicXML(makeScore([]));
    expect(xml).toMatch(/^<\?xml/);
  });
});

// ── Tests armure et métrique ──────────────────────────────────

describe("scoreToMusicXML — armure et métrique", () => {
  it("armure 2 dièses (Ré majeur) → <fifths>2</fifths>", () => {
    const xml = scoreToMusicXML(makeScore([], { fifths: 2 }));
    expect(xml).toContain("<fifths>2</fifths>");
  });

  it("armure -3 (Mib majeur) → <fifths>-3</fifths>", () => {
    const xml = scoreToMusicXML(makeScore([], { fifths: -3 }));
    expect(xml).toContain("<fifths>-3</fifths>");
  });

  it("mode mineur → <mode>minor</mode>", () => {
    const xml = scoreToMusicXML(makeScore([], { mode: "minor" }));
    expect(xml).toContain("<mode>minor</mode>");
  });

  it("métrique 3/4 → <beats>3</beats><beat-type>4</beat-type>", () => {
    const xml = scoreToMusicXML(makeScore([], { timeSig: [3, 4] }));
    expect(xml).toContain("<beats>3</beats>");
    expect(xml).toContain("<beat-type>4</beat-type>");
  });
});

// ── Tests tempo ───────────────────────────────────────────────

describe("scoreToMusicXML — direction tempo", () => {
  it("contient un élément <metronome>", () => {
    const xml = scoreToMusicXML(makeScore(
      [{ pitchMidi: 60, startTick: 0, durationTicks: 480 }],
      { bpm: 132 }
    ));
    expect(xml).toContain("<metronome>");
    expect(xml).toContain("<per-minute>132</per-minute>");
  });
});

// ── Tests erreurs ─────────────────────────────────────────────

describe("scoreToMusicXML — erreurs", () => {
  it("lève une erreur si trackIndex n'existe pas", () => {
    const score = makeScore([]);
    expect(() => scoreToMusicXML(score, 5)).toThrow("Track 5 not found");
  });

  it("ne lève pas d'erreur sur un score vide (0 notes)", () => {
    expect(() => scoreToMusicXML(makeScore([]), 0)).not.toThrow();
  });
});
