import { describe, it, expect } from "vitest";
import {
  alphaTabDurationToTicks,
  buildExpandedBars,
  dynamicToVelocity,
  DYNAMIC_VELOCITY,
  TRANSPOSITION_BY_PROGRAM,
  type MasterBarLike,
} from "../src/parsers/gp-parser.js";

// ═══════════════════════════════════════════════════════════════
// Helper : MasterBar minimal satisfaisant MasterBarLike
// ═══════════════════════════════════════════════════════════════

function mb(
  num = 4,
  den = 4,
  opts: Partial<{ repeatStart: boolean; repeatEnd: boolean; repeatCount: number }> = {}
): MasterBarLike {
  return {
    timeSignatureNumerator:   num,
    timeSignatureDenominator: den,
    isRepeatStart:            opts.repeatStart  ?? false,
    isRepeatEnd:              opts.repeatEnd    ?? false,
    repeatCount:              opts.repeatCount  ?? 2,
  };
}

const PPQ = 480;
const BAR_4_4 = PPQ * 4;        // 1920 ticks
const BAR_3_4 = PPQ * 3;        // 1440 ticks
const BAR_6_8 = PPQ * 4 * 6/8; // 1440 ticks (idem 3/4 à PPQ 480)

// ═══════════════════════════════════════════════════════════════
// alphaTabDurationToTicks
// ═══════════════════════════════════════════════════════════════

describe("alphaTabDurationToTicks — valeurs de base (PPQ=480)", () => {
  it.each([
    [1,  0, 1920, "ronde"],
    [2,  0,  960, "blanche"],
    [4,  0,  480, "noire"],
    [8,  0,  240, "croche"],
    [16, 0,  120, "double croche"],
    [32, 0,   60, "triple croche"],
    [64, 0,   30, "quadruple croche"],
  ])("Duration=%i dots=%i → %i ticks (%s)", (dur, dots, expected) => {
    expect(alphaTabDurationToTicks(dur, dots)).toBe(expected);
  });
});

describe("alphaTabDurationToTicks — notes pointées", () => {
  it.each([
    [2, 1, 1440, "blanche pointée (× 1.5)"],
    [4, 1,  720, "noire pointée (× 1.5)"],
    [8, 1,  360, "croche pointée (× 1.5)"],
    [4, 2,  840, "noire doublement pointée (× 1.75)"],
    [2, 2, 1680, "blanche doublement pointée (× 1.75)"],
  ])("Duration=%i dots=%i → %i ticks (%s)", (dur, dots, expected) => {
    expect(alphaTabDurationToTicks(dur, dots)).toBe(expected);
  });
});

describe("alphaTabDurationToTicks — valeurs négatives (brèves)", () => {
  it("double ronde (-2) = 3840 ticks", () => {
    expect(alphaTabDurationToTicks(-2, 0)).toBe(3840);
  });

  it("quadruple ronde (-4) = 7680 ticks", () => {
    expect(alphaTabDurationToTicks(-4, 0)).toBe(7680);
  });
});

// ═══════════════════════════════════════════════════════════════
// dynamicToVelocity
// ═══════════════════════════════════════════════════════════════

describe("dynamicToVelocity", () => {
  it("retourne 80 (MF) pour undefined — valeur par défaut Guitar Pro", () => {
    expect(dynamicToVelocity(undefined)).toBe(80);
    expect(dynamicToVelocity(null)).toBe(80);
  });

  it("retourne 80 pour une valeur hors map", () => {
    expect(dynamicToVelocity(99)).toBe(80);
    expect(dynamicToVelocity(-1)).toBe(80);
  });

  it.each(Object.entries(DYNAMIC_VELOCITY) as [string, number][])(
    "DynamicValue=%s → velocity=%i",
    (dv, expected) => {
      expect(dynamicToVelocity(Number(dv))).toBe(expected);
    }
  );

  it("PPP (0) est le plus faible — PP (1) > PPP", () => {
    expect(dynamicToVelocity(1)).toBeGreaterThan(dynamicToVelocity(0));
  });

  it("FFF (7) est le plus fort — valeur maximale = 127", () => {
    expect(dynamicToVelocity(7)).toBe(127);
  });

  it("la dynamique est strictement croissante de PPP à FFF", () => {
    const velocities = [0, 1, 2, 3, 4, 5, 6, 7].map(dynamicToVelocity);
    for (let i = 1; i < velocities.length; i++) {
      expect(velocities[i]).toBeGreaterThan(velocities[i - 1]!);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// TRANSPOSITION_BY_PROGRAM
// ═══════════════════════════════════════════════════════════════

describe("TRANSPOSITION_BY_PROGRAM — transpositions écrit → concert", () => {
  it("alto sax (65) : -9 demi-tons (Mib)", () => {
    expect(TRANSPOSITION_BY_PROGRAM[65]).toBe(-9);
  });

  it("tenor sax (66) : -14 demi-tons (Sib octave grave)", () => {
    expect(TRANSPOSITION_BY_PROGRAM[66]).toBe(-14);
  });

  it("soprano sax (64) : -2 demi-tons (Sib)", () => {
    expect(TRANSPOSITION_BY_PROGRAM[64]).toBe(-2);
  });

  it("clarinette (71) : -2 demi-tons (Sib)", () => {
    expect(TRANSPOSITION_BY_PROGRAM[71]).toBe(-2);
  });

  it("trompette (56) : -2 demi-tons (Sib)", () => {
    expect(TRANSPOSITION_BY_PROGRAM[56]).toBe(-2);
  });
});

// ═══════════════════════════════════════════════════════════════
// buildExpandedBars — ticks
// ═══════════════════════════════════════════════════════════════

describe("buildExpandedBars — séquence sans répétition", () => {
  it("séquence linéaire : longueur = nombre de mesures", () => {
    expect(buildExpandedBars([mb(), mb(), mb()]).length).toBe(3);
  });

  it("les startTick s'incrémentent de barTicks (4/4 = 1920)", () => {
    const exp = buildExpandedBars([mb(), mb(), mb()]);
    expect(exp[0]!.startTick).toBe(0);
    expect(exp[1]!.startTick).toBe(BAR_4_4);
    expect(exp[2]!.startTick).toBe(BAR_4_4 * 2);
  });

  it("barTicks reflète la métrique (3/4 = 1440 ticks)", () => {
    const exp = buildExpandedBars([mb(3, 4)]);
    expect(exp[0]!.barTicks).toBe(BAR_3_4);
  });

  it("métriques mixtes : 4/4 puis 3/4", () => {
    const exp = buildExpandedBars([mb(4, 4), mb(3, 4)]);
    expect(exp[0]!.startTick).toBe(0);
    expect(exp[1]!.startTick).toBe(BAR_4_4);
    expect(exp[1]!.barTicks).toBe(BAR_3_4);
  });

  it("retourne [] pour un tableau vide", () => {
    expect(buildExpandedBars([])).toEqual([]);
  });

  it("masterBarIdx correspond à l'index original", () => {
    const exp = buildExpandedBars([mb(), mb(), mb()]);
    expect(exp.map((e) => e.masterBarIdx)).toEqual([0, 1, 2]);
  });
});

describe("buildExpandedBars — répétitions x2", () => {
  it("||: A B :|| → A B A B (4 mesures)", () => {
    const exp = buildExpandedBars([
      mb(4, 4, { repeatStart: true }),
      mb(4, 4, { repeatEnd: true, repeatCount: 2 }),
    ]);
    expect(exp.length).toBe(4);
  });

  it("les masterBarIdx de la répétition correspondent aux originaux", () => {
    const exp = buildExpandedBars([
      mb(4, 4, { repeatStart: true }),
      mb(4, 4, { repeatEnd: true, repeatCount: 2 }),
    ]);
    expect(exp.map((e) => e.masterBarIdx)).toEqual([0, 1, 0, 1]);
  });

  it("les ticks de la répétition font suite aux originaux", () => {
    const exp = buildExpandedBars([
      mb(4, 4, { repeatStart: true }),
      mb(4, 4, { repeatEnd: true, repeatCount: 2 }),
    ]);
    expect(exp[2]!.startTick).toBe(BAR_4_4 * 2);
    expect(exp[3]!.startTick).toBe(BAR_4_4 * 3);
  });
});

describe("buildExpandedBars — répétitions x3+", () => {
  it("||: A :|| avec repeatCount=3 → A A A (6 mesures)", () => {
    const exp = buildExpandedBars([
      mb(4, 4, { repeatStart: true }),
      mb(4, 4, { repeatEnd: true, repeatCount: 3 }),
    ]);
    expect(exp.length).toBe(6);
  });

  it("||: A :|| avec repeatCount=4 → 8 mesures", () => {
    const exp = buildExpandedBars([
      mb(4, 4, { repeatStart: true }),
      mb(4, 4, { repeatEnd: true, repeatCount: 4 }),
    ]);
    expect(exp.length).toBe(8);
  });
});

describe("buildExpandedBars — sections consécutives", () => {
  it("||:A:|| B ||:C:|| → 4+1+4 = 9 mesures (A et C = 2 mesures chacune)", () => {
    const exp = buildExpandedBars([
      mb(4, 4, { repeatStart: true }),
      mb(4, 4, { repeatEnd: true, repeatCount: 2 }),
      mb(),                                        // B
      mb(4, 4, { repeatStart: true }),
      mb(4, 4, { repeatEnd: true, repeatCount: 2 }),
    ]);
    expect(exp.length).toBe(9);
    expect(exp[4]!.masterBarIdx).toBe(2); // B
  });

  it("les ticks sont continus après deux sections", () => {
    const exp = buildExpandedBars([
      mb(4, 4, { repeatStart: true }),
      mb(4, 4, { repeatEnd: true, repeatCount: 2 }),
      mb(),
    ]);
    // 2 mesures × 2 + 1 mesure = 5 ; la 5ème commence à tick 4 * BAR_4_4
    expect(exp[4]!.startTick).toBe(BAR_4_4 * 4);
  });
});

describe("buildExpandedBars — cas limites", () => {
  it(":|| sans ||: précédent → rejoue depuis le début (index 0)", () => {
    const exp = buildExpandedBars([
      mb(),
      mb(4, 4, { repeatEnd: true, repeatCount: 2 }),
    ]);
    expect(exp.length).toBe(4);
    expect(exp[2]!.masterBarIdx).toBe(0);
    expect(exp[3]!.masterBarIdx).toBe(1);
  });

  it("repeatCount=1 (ou indéfini) est traité comme 2 (minimum de sécurité)", () => {
    // repeatCount=1 voudrait dire 1 lecture = pas de répétition, ce qui serait
    // un bug de fichier. On applique max(2, repeatCount) → au moins 1 répétition.
    const exp = buildExpandedBars([
      mb(4, 4, { repeatStart: true }),
      mb(4, 4, { repeatEnd: true, repeatCount: 1 }),
    ]);
    expect(exp.length).toBe(4); // forcé à 2 lectures = 4 mesures
  });

  it("répétition d'une seule mesure 3/4", () => {
    const exp = buildExpandedBars([
      mb(3, 4, { repeatStart: true, repeatEnd: true, repeatCount: 2 }),
    ]);
    expect(exp.length).toBe(2);
    expect(exp[0]!.barTicks).toBe(BAR_3_4);
    expect(exp[1]!.barTicks).toBe(BAR_3_4);
    expect(exp[1]!.startTick).toBe(BAR_3_4);
  });
});
