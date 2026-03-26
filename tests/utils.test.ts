import { describe, it, expect } from "vitest";
import { getGMInstrumentLabel, GM_PROGRAM_NAMES } from "../src/utils/gm-programs.js";
import { tracksToTrackInfos } from "../src/utils/list-tracks.js";
import type { ParsedTrack } from "../src/types.js";

// ═══════════════════════════════════════════════════════════════
// GM Programs
// ═══════════════════════════════════════════════════════════════

describe("getGMInstrumentLabel", () => {
  it.each([
    [0,  "Acoustic Grand Piano"],
    [64, "Soprano Sax"],
    [65, "Alto Sax"],
    [66, "Tenor Sax"],
    [67, "Baritone Sax"],
    [71, "Clarinet"],
    [73, "Flute"],
    [56, "Trumpet"],
  ])("programme %i → '%s'", (program, expected) => {
    expect(getGMInstrumentLabel(program)).toBe(expected);
  });

  it("programme inconnu → 'MIDI Program N'", () => {
    expect(getGMInstrumentLabel(127)).toBe("MIDI Program 127");
    expect(getGMInstrumentLabel(99)).toBe("MIDI Program 99");
  });

  it("programme 0 est dans la map", () => {
    expect(GM_PROGRAM_NAMES[0]).toBeDefined();
  });

  it("tous les programmes saxophone (64–67) sont dans la map", () => {
    expect(GM_PROGRAM_NAMES[64]).toBeDefined();
    expect(GM_PROGRAM_NAMES[65]).toBeDefined();
    expect(GM_PROGRAM_NAMES[66]).toBeDefined();
    expect(GM_PROGRAM_NAMES[67]).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// tracksToTrackInfos
// ═══════════════════════════════════════════════════════════════

function makeTrack(overrides: Partial<ParsedTrack> = {}): ParsedTrack {
  return {
    id:          0,
    name:        "Alto Sax",
    midiProgram: 65,
    midiChannel: 0,
    notes:       [],
    isSaxophone: true,
    ...overrides,
  };
}

describe("tracksToTrackInfos", () => {
  it("retourne un tableau de même longueur que l'entrée", () => {
    const tracks = [makeTrack({ id: 0 }), makeTrack({ id: 1 }), makeTrack({ id: 2 })];
    expect(tracksToTrackInfos(tracks)).toHaveLength(3);
  });

  it("retourne [] pour une entrée vide", () => {
    expect(tracksToTrackInfos([])).toEqual([]);
  });

  it("index = track.id", () => {
    const info = tracksToTrackInfos([makeTrack({ id: 7 })])[0]!;
    expect(info.index).toBe(7);
  });

  it("name copié tel quel", () => {
    const info = tracksToTrackInfos([makeTrack({ name: "Tenor Saxophone" })])[0]!;
    expect(info.name).toBe("Tenor Saxophone");
  });

  it("midiProgram copié", () => {
    const info = tracksToTrackInfos([makeTrack({ midiProgram: 66 })])[0]!;
    expect(info.midiProgram).toBe(66);
  });

  it("midiChannel copié", () => {
    const info = tracksToTrackInfos([makeTrack({ midiChannel: 9 })])[0]!;
    expect(info.midiChannel).toBe(9);
  });

  it("noteCount = notes.length", () => {
    const notes = [
      { pitchMidi: 60, startTick: 0, durationTicks: 480, velocity: 80 },
      { pitchMidi: 62, startTick: 480, durationTicks: 480, velocity: 80 },
    ];
    const info = tracksToTrackInfos([makeTrack({ notes })])[0]!;
    expect(info.noteCount).toBe(2);
  });

  it("noteCount = 0 pour un track sans notes", () => {
    const info = tracksToTrackInfos([makeTrack({ notes: [] })])[0]!;
    expect(info.noteCount).toBe(0);
  });

  it("isSaxophone copié", () => {
    expect(tracksToTrackInfos([makeTrack({ isSaxophone: true })])[0]!.isSaxophone).toBe(true);
    expect(tracksToTrackInfos([makeTrack({ isSaxophone: false })])[0]!.isSaxophone).toBe(false);
  });

  it("instrumentLabel provient de GM_PROGRAM_NAMES", () => {
    const info = tracksToTrackInfos([makeTrack({ midiProgram: 65 })])[0]!;
    expect(info.instrumentLabel).toBe("Alto Sax");
  });

  it("instrumentLabel fallback pour programme inconnu", () => {
    const info = tracksToTrackInfos([makeTrack({ midiProgram: 127 })])[0]!;
    expect(info.instrumentLabel).toContain("127");
  });

  it("ordre des tracks préservé", () => {
    const tracks = [
      makeTrack({ id: 2, name: "Bass" }),
      makeTrack({ id: 0, name: "Alto Sax" }),
      makeTrack({ id: 1, name: "Guitar" }),
    ];
    const infos = tracksToTrackInfos(tracks);
    expect(infos[0]!.name).toBe("Bass");
    expect(infos[1]!.name).toBe("Alto Sax");
    expect(infos[2]!.name).toBe("Guitar");
  });
});
