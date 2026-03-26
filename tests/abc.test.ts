import { describe, it, expect } from "vitest";
import { scoreToABC } from "../src/exporters/to-abc.js";
import type { ParsedScore } from "../src/types.js";

// ── Fixtures ─────────────────────────────────────────────────

function makeScore(
  notes: Array<{ pitchMidi: number; startTick: number; durationTicks: number; isRest?: boolean }>,
  opts: Partial<{
    title: string; composer: string; artist: string; ppq: number;
    fifths: number; mode: "major" | "minor"; bpm: number;
    timeSig: [number, number];
  }> = {}
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
      id: 0, name: "Track", midiProgram: 0, midiChannel: 0,
      isSaxophone: false,
      notes: notes.map((n) => ({ ...n, velocity: 80 })),
    }],
  };
}

function header(score: ParsedScore): string {
  return scoreToABC(score).split("\n").filter((l) => !l.startsWith(" ") && l.trim()).join("\n");
}

// ── Tests header ABC ──────────────────────────────────────────

describe("scoreToABC — header", () => {
  it("commence par X:1", () => {
    expect(scoreToABC(makeScore([]))).toMatch(/^X:1/);
  });

  it("titre en T:", () => {
    expect(scoreToABC(makeScore([], { title: "Autumn Leaves" }))).toContain("T:Autumn Leaves");
  });

  it("compositeur en C:", () => {
    expect(scoreToABC(makeScore([], { composer: "Joseph Kosma" }))).toContain("C:Joseph Kosma");
  });

  it("M: reflète la métrique", () => {
    expect(scoreToABC(makeScore([], { timeSig: [3, 4] }))).toContain("M:3/4");
    expect(scoreToABC(makeScore([], { timeSig: [4, 4] }))).toContain("M:4/4");
    expect(scoreToABC(makeScore([], { timeSig: [6, 8] }))).toContain("M:6/8");
  });

  it("L:1/8 (longueur de note de référence fixe)", () => {
    expect(scoreToABC(makeScore([]))).toContain("L:1/8");
  });

  it("Q: contient le BPM en noires par minute", () => {
    expect(scoreToABC(makeScore([], { bpm: 132 }))).toContain("Q:1/4=132");
    expect(scoreToABC(makeScore([], { bpm: 60  }))).toContain("Q:1/4=60");
  });

  it("K: reflète l'armure (C majeur)", () => {
    expect(scoreToABC(makeScore([], { fifths: 0 }))).toContain("K:C");
  });

  it("K: reflète l'armure (G majeur, 1 dièse)", () => {
    expect(scoreToABC(makeScore([], { fifths: 1 }))).toContain("K:G");
  });

  it("K: reflète l'armure (Bb majeur, -2 = 2 bémols)", () => {
    expect(scoreToABC(makeScore([], { fifths: -2 }))).toContain("K:Bb");
  });

  it("K: mode mineur → Cm, Am, etc.", () => {
    expect(scoreToABC(makeScore([], { fifths: 0, mode: "minor" }))).toContain("K:Cm");
    expect(scoreToABC(makeScore([], { fifths: 3, mode: "minor" }))).toContain("K:Am");
  });

  it("pas de ligne T: si le titre est vide", () => {
    const abc = scoreToABC(makeScore([], { title: "" }));
    expect(abc).not.toContain("\nT:");
  });
});

// ── Tests armures ─────────────────────────────────────────────

describe("scoreToABC — toutes les armures majeures", () => {
  it.each([
    [-7, "Cb"], [-6, "Gb"], [-5, "Db"], [-4, "Ab"], [-3, "Eb"],
    [-2, "Bb"], [-1, "F"],  [ 0, "C"],  [ 1, "G"],  [ 2, "D"],
    [ 3, "A"],  [ 4, "E"],  [ 5, "B"],  [ 6, "F#"], [ 7, "C#"],
  ])("fifths=%i → K:%s", (fifths, key) => {
    expect(scoreToABC(makeScore([], { fifths }))).toContain(`K:${key}`);
  });
});

// ── Tests pitch ABC ───────────────────────────────────────────

describe("scoreToABC — noms de notes et octaves", () => {
  function firstNote(midiNote: number): string {
    // On génère une noire (480 ticks à PPQ=480)
    const abc = scoreToABC(makeScore([{ pitchMidi: midiNote, startTick: 0, durationTicks: 480 }]));
    // La dernière ligne contient les notes du corps
    const body = abc.split("\n").slice(-1)[0] ?? "";
    return body;
  }

  it("C4 (MIDI 60) → note 'C' majuscule (octave 4 = référence ABC)", () => {
    expect(firstNote(60)).toContain("C");
  });

  it("C5 (MIDI 72) → note 'c' minuscule (octave 5)", () => {
    expect(firstNote(72)).toMatch(/\bc/);
  });

  it("C3 (MIDI 48) → 'C,' avec virgule (octave 3)", () => {
    expect(firstNote(48)).toContain("C,");
  });

  it("C6 (MIDI 84) → 'c\\'' avec apostrophe (octave 6)", () => {
    expect(firstNote(84)).toContain("c'");
  });

  it("F#4 (MIDI 66) → '^F' (dièse)", () => {
    expect(firstNote(66)).toContain("^F");
  });

  it("C#4 (MIDI 61) → '^C' (dièse)", () => {
    expect(firstNote(61)).toContain("^C");
  });

  it("A#4 / Bb4 (MIDI 70) → '^A' (exprimé en dièse)", () => {
    expect(firstNote(70)).toContain("^A");
  });

  it("B4 (MIDI 71) → 'B' (naturel, pas de dièse)", () => {
    const body = firstNote(71);
    expect(body).toContain("B");
    expect(body).not.toContain("^B");
  });
});

// ── Tests durées ABC ──────────────────────────────────────────

describe("scoreToABC — durées (L=1/8)", () => {
  // PPQ=480, L=1/8 (= 240 ticks)
  // Durée relative à L : noire (480 ticks) = 2×L → "C2"

  function body(durationTicks: number): string {
    const abc = scoreToABC(makeScore([{ pitchMidi: 60, startTick: 0, durationTicks }]));
    return abc.split("\n").pop() ?? "";
  }

  it("ronde (1920 ticks) → note durée 8 ('C8')", () => {
    expect(body(1920)).toMatch(/C8/);
  });

  it("blanche (960 ticks) → note durée 4 ('C4')", () => {
    expect(body(960)).toMatch(/C4/);
  });

  it("noire (480 ticks) → note durée 2 ('C2')", () => {
    expect(body(480)).toMatch(/C2/);
  });

  it("croche (240 ticks) → note sans suffixe ou durée '' ('C' seul)", () => {
    // L=1/8 = croche → la durée relative est 1 → symbole vide
    expect(body(240)).toMatch(/C(?!\d)/);
  });

  it("double croche (120 ticks) → note durée '/2' ('C/2')", () => {
    expect(body(120)).toMatch(/C\/2/);
  });
});

// ── Tests silences ────────────────────────────────────────────

describe("scoreToABC — silences", () => {
  it("gap entre deux notes génère un 'z' (silence)", () => {
    const abc = scoreToABC(makeScore([
      { pitchMidi: 60, startTick: 0,   durationTicks: 480 },
      { pitchMidi: 62, startTick: 960, durationTicks: 480 }, // gap de 480 ticks
    ]));
    expect(abc).toContain("z");
  });

  it("note isRest → rendu comme 'z'", () => {
    const abc = scoreToABC(makeScore([
      { pitchMidi: 0, startTick: 0, durationTicks: 480, isRest: true },
    ]));
    expect(abc).toContain("z");
  });
});

// ── Tests multi-mesures ───────────────────────────────────────

describe("scoreToABC — barres et groupement", () => {
  it("les mesures sont séparées par '|'", () => {
    // 2 noires dans une mesure de 4/4 (4 noires = 1920 ticks)
    const score = makeScore([
      { pitchMidi: 60, startTick: 0,    durationTicks: 480 },
      { pitchMidi: 62, startTick: 480,  durationTicks: 480 },
      { pitchMidi: 64, startTick: 960,  durationTicks: 480 },
      { pitchMidi: 65, startTick: 1440, durationTicks: 480 },
      // 2ème mesure
      { pitchMidi: 67, startTick: 1920, durationTicks: 480 },
      { pitchMidi: 69, startTick: 2400, durationTicks: 480 },
      { pitchMidi: 71, startTick: 2880, durationTicks: 480 },
      { pitchMidi: 72, startTick: 3360, durationTicks: 480 },
    ]);
    const abc = scoreToABC(score);
    expect(abc).toContain("|");
  });

  it("groupement 4 mesures par ligne", () => {
    // 5 mesures → 2 lignes (4 + 1)
    const notes = Array.from({ length: 5 }, (_, i) => ({
      pitchMidi: 60,
      startTick: i * 1920,    // chaque note remplit une mesure 4/4 (ronde)
      durationTicks: 1920,
    }));
    const abc = scoreToABC(makeScore(notes));
    const bodyLines = abc.split("\n").filter((l) => l.includes("|"));
    expect(bodyLines.length).toBe(2); // 4 mesures ligne 1, 1 mesure ligne 2
  });
});

// ── Tests erreurs ─────────────────────────────────────────────

describe("scoreToABC — erreurs", () => {
  it("lève une erreur si trackIndex n'existe pas", () => {
    expect(() => scoreToABC(makeScore([]), 5)).toThrow("Track 5 not found");
  });

  it("track sans notes : retourne du texte valide sans planter", () => {
    expect(() => scoreToABC(makeScore([], { title: "Empty" }), 0)).not.toThrow();
  });
});
