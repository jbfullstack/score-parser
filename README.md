# score-parser

Parse MIDI and Guitar Pro files into a clean, format-neutral JSON structure.

Handles **transposing instruments** correctly (saxophone, clarinet, trumpet) — written pitch is automatically converted to concert pitch based on the MIDI program number.

## Install

```sh
npm install score-parser @tonejs/midi @coderline/alphatab
```

> `@tonejs/midi` and `@coderline/alphatab` are peer dependencies — install them once even if you use multiple packages that depend on them.

## Quick start

```ts
import { parseFile } from "score-parser";
import { readFile } from "node:fs/promises";

const buf = await readFile("song.gp5");
const score = await parseFile(buf, { ext: "gp5" });

const saxTrack = score.tracks.find(t => t.isSaxophone);
console.log(`${saxTrack?.notes.length} notes at concert pitch`);

// First note
const note = saxTrack?.notes[0];
console.log(`MIDI ${note?.pitchMidi}, tick ${note?.startTick}, dur ${note?.durationTicks}`);
```

## Why this exists

Most JavaScript music parsing libraries either:
- Ignore transposing instruments (a written Bb on an alto sax is an actual concert Db)
- Expose format-specific APIs that make it hard to switch between MIDI and Guitar Pro
- Don't handle Guitar Pro repeat signs, tuplets, or tied notes correctly

`score-parser` gives you a single `ParsedScore` object regardless of input format, with all pitches in **concert pitch** (MIDI note numbers, middle C = 60).

## Supported formats

| Format | Extension | Underlying lib | Known limitations |
|--------|-----------|----------------|-------------------|
| MIDI   | `.mid` `.midi` | `@tonejs/midi` | Key signatures not extracted; multi-channel tracks use first channel |
| Guitar Pro | `.gp` `.gp3` `.gp4` `.gp5` `.gpx` | `@coderline/alphatab` | Volta brackets (1st/2nd ending) not expanded |

## API Reference

### `parseFile(buffer, options?)`

Unified dispatcher — recommended entry point.

```ts
const score = await parseFile(buffer, {
  ext: "gp5",             // file extension (required unless magic bytes are detectable)
  expandRepeats: true,    // unfold ||: :|| repeat signs (GP only, default: true)
});
```

### `parseMidi(buffer, options?)`

Parse a MIDI file directly.

```ts
const score = parseMidi(buffer, {
  ppqOverride: 480,   // force PPQ value (optional)
});
```

### `parseGuitarPro(buffer, options?)`

Parse a Guitar Pro file directly.

```ts
const score = await parseGuitarPro(buffer, {
  expandRepeats: true,
});
```

### `listTracksFromBuffer(buffer, ext)`

Preview track names and note counts without a full parse — useful for a track-selection UI.

```ts
const result = await listTracksFromBuffer(buffer, "gp5");
// { title, artist, format, tracks: TrackInfo[] }
for (const t of result.tracks) {
  console.log(`[${t.index}] ${t.name} — ${t.instrumentLabel} — ${t.noteCount} notes`);
}
```

### `scoreToMusicXML(score, trackIndex?)`

Export a track to MusicXML v4.0 (Sibelius, Finale, MuseScore, Dorico compatible).

```ts
const xml = scoreToMusicXML(score, 0);
await writeFile("output.xml", xml);
```

### `scoreToABC(score, trackIndex?)`

Export a track to ABC Notation v2.1.

```ts
const abc = scoreToABC(score, 0);
```

## ParsedScore format

```jsonc
{
  "title": "My Song",
  "artist": "Artist",
  "composer": "Composer",
  "ppq": 480,                        // ticks per quarter note
  "sourceFormat": "gpx",             // "midi" | "gpx" | "gp"
  "tempos": [{ "tick": 0, "bpm": 120 }],
  "timeSigs": [{ "tick": 0, "numerator": 4, "denominator": 4 }],
  "keySigs": [{ "tick": 0, "fifths": 0, "mode": "major" }],  // fifths: -7..+7
  "tracks": [{
    "id": 0,
    "name": "Alto Sax",
    "midiProgram": 65,               // GM program (65 = Alto Sax)
    "midiChannel": 0,
    "isSaxophone": true,             // auto-detected
    "notes": [{
      "pitchMidi": 65,               // concert pitch, MIDI note number
      "startTick": 0,
      "durationTicks": 480,          // 480 = quarter note at PPQ 480
      "velocity": 80,                // 0–127
      "isRest": false,
      "annotations": ["bend"]        // optional: guitar effects (informational only)
    }]
  }]
}
```

## Transposing instruments

All pitches are stored at **concert pitch** (the actual sounding pitch). The conversion from written pitch (as printed in the score) to concert pitch is applied automatically based on the MIDI program number.

| Instrument | GM Program | Transposition (written → concert) |
|------------|------------|----------------------------------|
| Soprano Sax | 64 | −2 semitones (Bb instrument) |
| Alto Sax | 65 | −9 semitones (Eb instrument) |
| Tenor Sax | 66 | −14 semitones (Bb, lower octave) |
| Baritone Sax | 67 | −21 semitones (Eb, lower octave) |
| Bb Clarinet | 71 | −2 semitones |
| Bb Trumpet | 56 | −2 semitones |

MIDI files are assumed to already be at concert pitch (no transposition applied).

## CLI

```sh
# List tracks
npx score-parser song.gp5 --list-tracks

# Export specific track to MusicXML
npx score-parser song.gp5 --track 2 --format musicxml --out song.xml

# Pipe JSON to jq
npx score-parser song.mid --format json | jq '.tracks[0].notes | length'

# Disable repeat expansion
npx score-parser song.gp5 --no-expand-repeats --format json
```

## Limitations

- **Volta brackets** (1st/2nd endings): not expanded — only the first pass is parsed.
- **Multi-channel MIDI tracks**: only the first channel is used.
- **Guitar ornaments** (bend, vibrato, hammer-on, etc.): stored as `annotations[]` on the note but not sonically modeled.
- **Grace notes**: duration is approximated as a 32nd note.

## License

MIT

![CI](https://github.com/jbfullstack/score-parser/actions/workflows/ci.yml/badge.svg)
![npm](https://img.shields.io/npm/v/score-parser)
![license](https://img.shields.io/npm/l/score-parser)
