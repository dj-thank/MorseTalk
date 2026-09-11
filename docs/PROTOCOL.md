# MorseTalk MT1 wire format

MT1 is a project-specific transport carried by audible International Morse. It is not Wabun, encrypted communication, a standard radio protocol, or a voice codec.

## Timing and character layer

The unit is `1.2 / WPM` seconds, with supported UI speeds 8–60 WPM. Dot = 1 unit, dash = 3, intra-character gap = 1, letter gap = 3, word gap = 7. Leading silence is 7 units; terminal silence is at least 18 units / 1.1 seconds. Receiver flush silence is max(15 units, 900 ms). Tone selection is shared by sender and receiver; 700 Hz by default. Synthesis uses 3 ms gain ramps when the mark duration permits. It uses one sine oscillator, not thousands of timer callbacks.

The character map follows the implemented subset of ITU-R M.1677-1. A–Z, 0–9, É, and explicitly supported punctuation are available. Unsupported text never silently disappears. Human-oriented International/Wabun modes have no CRC and therefore cannot guarantee recognition correctness.

## Frame text

```
VVV MT1 <unpadded RFC4648 uppercase Base32> KKK
```

Whitespace shown above is a word separator in audible Morse. Base32 is **one word**, without word gaps inside it. There is no language model correcting the received symbols: invalid alphabet, noncanonical padding bits, malformed header, wrong length, bad CRC, or invalid UTF-8 rejects the whole packet.

## Binary payload before Base32

All multibyte integers use network / big-endian byte order.

| Offset | Bytes | Field |
|---|---:|---|
| 0 | 1 | Flags: `0x01` DATA, `0x05` DATA requesting ACK, `0x02` ACK. Other values invalid |
| 1 | 2 | Communication code as uint16, decimal 0000–9999 |
| 3 | 4 | Message ID, uint32 |
| 7 | 2 | UTF-8 payload length, 0–240 |
| 9 | N | UTF-8 bytes; DATA must be nonempty, ACK must be empty |
| 9+N | 4 | CRC32 of every preceding binary byte |

CRC is the reflected CRC-32/ISO-HDLC algorithm: polynomial `0xEDB88320`, initial value `0xFFFFFFFF`, final XOR `0xFFFFFFFF`. Check vector: ASCII `123456789` → `CBF43926`. There is no terminator in the checksum domain. Total frame bytes = 13+N.

Example vectors can be generated from `app/core/packet.mjs`; deterministic examples are in `examples/` with matching `settings.json`. New UI message IDs use `crypto.getRandomValues`, not a global increment shared between devices. IDs and room codes are not secret or authenticated.

## Reception and ACK

Receiver verifies structure and CRC before applying a room filter. A different valid room is ignored. A data frame updates a bounded 128-entry, 10-minute duplicate window keyed on room+ID+text. Repeated DATA can still be acknowledged but does not display/speak twice.

When enabled, the receiver responds with ACK carrying the same ID/room, after closing its microphone and a 1.5-second turnaround delay. ACK happens before TTS. The sender only accepts ACK matching the pending room and ID. Other ACKs are ignored. The deadline starts after full local playback; timeout is the synthesized ACK duration plus 8.5 seconds. At most one retry uses the same frame/ID. There is no unbounded retry loop.

When a valid incoming message needs an ACK or TTS while this endpoint awaits an ACK, its retry timer is paused and rearmed after those local operations. User stop, page hiding, or native pause cancels the pending transaction. A missing ACK means **delivery unknown**, not necessarily failed delivery. A matching ACK confirms receipt by some compatible responder, not that responder's identity.

This is half-duplex push-to-send operation, without channel reservation, carrier-sense collision avoidance, network discovery, forward error correction, out-of-order reassembly, multi-packet long-message fragmentation, or acoustic echo cancellation. Two people must take turns. Long sentences should be split manually.

## Streaming DSP

A 5 ms window computes DC-rejected quadrature amplitude and tone-energy purity. Hysteresis and a two-window dwell limit accidental toggling. PulseDecoder maps mark and gap durations relative to the configured WPM. It rejects oversized or unknown symbols and limits accumulated state. AudioWorklet emits level updates at 20 Hz and bounded messages; its output is always zero, so the microphone is never monitored into the speaker.

Recorded speech uses a separate mode that emits bounded 2048-sample batches. The UI limits it to 20 seconds, downsamples to mono16k PCM16, and sends only to the local host recognition endpoint. Android native recognition bypasses that HTTP pathway and calls the local platform recognizer.

## Human modes

Wabun normalizes hiragana/halfwidth kana and separates dakuten/handakuten for transport, recombining Unicode after decode. Small kana become large kana. Kanji readings are deliberately not guessed. Both parties manually select Wabun. Continuous DO/SN shift prosigns and mode changes inside a transmission are not supported. Fixed-speed operation should not be mistaken for adaptive decoding of arbitrary expert hand-key Morse.
