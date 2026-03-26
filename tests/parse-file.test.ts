import { describe, it, expect } from "vitest";
import { parseFile, detectFormatFromBytes } from "../src/parse-file.js";

// ═══════════════════════════════════════════════════════════════
// Helpers MIDI (dupliqués légèrement ici pour l'isolation des tests)
// ═══════════════════════════════════════════════════════════════

function midiMagicBytes(): Buffer {
  // MThd header minimal valide (14 bytes) + track chunk minimal
  const header = Buffer.from([
    0x4D, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06, // length = 6
    0x00, 0x00,             // format 0
    0x00, 0x01,             // 1 track
    0x01, 0xE0,             // PPQ = 480
  ]);
  const trackEvents = Buffer.from([
    0x00, 0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20, // set_tempo 120 BPM
    0x00, 0xFF, 0x2F, 0x00,                     // end of track
  ]);
  const trackHeader = Buffer.alloc(8);
  trackHeader.write("MTrk", 0, "ascii");
  trackHeader.writeUInt32BE(trackEvents.length, 4);
  return Buffer.concat([header, trackHeader, trackEvents]);
}

function gpMagicBytes(): Buffer {
  // ZIP magic bytes (GPX, GP5, GP4)
  return Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
}

// ═══════════════════════════════════════════════════════════════
// detectFormatFromBytes
// ═══════════════════════════════════════════════════════════════

describe("detectFormatFromBytes", () => {
  it("détecte 'midi' depuis le magic MThd (0x4D 0x54 0x68 0x64)", () => {
    const buf = Buffer.from([0x4D, 0x54, 0x68, 0x64, 0x00, 0x00]);
    expect(detectFormatFromBytes(buf)).toBe("midi");
  });

  it("détecte 'gp' depuis le magic ZIP PK (0x50 0x4B 0x03 0x04)", () => {
    const buf = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00]);
    expect(detectFormatFromBytes(buf)).toBe("gp");
  });

  it("retourne null pour un buffer inconnu", () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(detectFormatFromBytes(buf)).toBeNull();
  });

  it("retourne null pour un buffer trop court (<4 bytes)", () => {
    expect(detectFormatFromBytes(Buffer.from([0x4D, 0x54]))).toBeNull();
    expect(detectFormatFromBytes(Buffer.alloc(0))).toBeNull();
  });

  it("Uint8Array fonctionne comme Buffer", () => {
    const buf = new Uint8Array([0x4D, 0x54, 0x68, 0x64]);
    expect(detectFormatFromBytes(buf)).toBe("midi");
  });
});

// ═══════════════════════════════════════════════════════════════
// parseFile — dispatch par extension
// ═══════════════════════════════════════════════════════════════

describe("parseFile — dispatch par extension", () => {
  it("ext='mid' → parseMidi appelé → sourceFormat='midi'", async () => {
    const score = await parseFile(midiMagicBytes(), { ext: "mid" });
    expect(score.sourceFormat).toBe("midi");
  });

  it("ext='midi' → parseMidi appelé", async () => {
    const score = await parseFile(midiMagicBytes(), { ext: "midi" });
    expect(score.sourceFormat).toBe("midi");
  });

  it("ext='.mid' avec point → fonctionne (le point est retiré)", async () => {
    const score = await parseFile(midiMagicBytes(), { ext: ".mid" });
    expect(score.sourceFormat).toBe("midi");
  });

  it("ext insensible à la casse : 'MID' → parseMidi", async () => {
    const score = await parseFile(midiMagicBytes(), { ext: "MID" });
    expect(score.sourceFormat).toBe("midi");
  });

  it("format inconnu avec ext absent → lève une erreur", async () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    await expect(parseFile(buf)).rejects.toThrow("Unsupported format");
  });

  it("format inconnu avec ext inconnu → lève une erreur avec l'extension", async () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    await expect(parseFile(buf, { ext: "xyz" })).rejects.toThrow(".xyz");
  });
});

// ═══════════════════════════════════════════════════════════════
// parseFile — auto-détection par magic bytes
// ═══════════════════════════════════════════════════════════════

describe("parseFile — auto-détection par magic bytes (sans ext)", () => {
  it("buffer MIDI sans ext → détecté via MThd → sourceFormat='midi'", async () => {
    const score = await parseFile(midiMagicBytes());
    expect(score.sourceFormat).toBe("midi");
  });

  it("buffer MIDI : PPQ et tempos sont peuplés", async () => {
    const score = await parseFile(midiMagicBytes());
    expect(score.ppq).toBeGreaterThan(0);
    expect(score.tempos.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// parseFile — propriétés du ParsedScore
// ═══════════════════════════════════════════════════════════════

describe("parseFile — contrat du ParsedScore retourné", () => {
  it("retourne ppq > 0", async () => {
    const score = await parseFile(midiMagicBytes(), { ext: "mid" });
    expect(score.ppq).toBeGreaterThan(0);
  });

  it("retourne au moins 1 tempo", async () => {
    const score = await parseFile(midiMagicBytes(), { ext: "mid" });
    expect(score.tempos.length).toBeGreaterThan(0);
    expect(score.tempos[0]!.bpm).toBeGreaterThan(0);
  });

  it("retourne au moins 1 time signature", async () => {
    const score = await parseFile(midiMagicBytes(), { ext: "mid" });
    expect(score.timeSigs.length).toBeGreaterThan(0);
    expect(score.timeSigs[0]!.numerator).toBeGreaterThan(0);
    expect(score.timeSigs[0]!.denominator).toBeGreaterThan(0);
  });

  it("tracks est un tableau (éventuellement vide)", async () => {
    const score = await parseFile(midiMagicBytes(), { ext: "mid" });
    expect(Array.isArray(score.tracks)).toBe(true);
  });
});
