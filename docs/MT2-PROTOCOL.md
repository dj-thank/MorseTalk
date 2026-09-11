# MT2 wire protocol — version 0.2.0

MT2 is an experimental machine-to-machine UTF-8 transport over actual International Morse timing. It is not interoperable with MT1 or a human Wabun message. There is no FSK, ultrasound, RF transmitter integration or IP payload shortcut.

## Frame

All multi-byte integers are unsigned big endian. CRC32 uses the existing project's IEEE CRC32 implementation and covers all bytes before the checksum. Raw text must be nonempty well-formed UTF-8 for DATA and empty for ACK.

| Offset | Bytes | Meaning |
|---|---:|---|
| 0 | 2 | Magic `4D 32` |
| 2 | 1 | flags: DATA=0, ACK=1, compressed DATA=4; others reject |
| 3 | 2 | room 0..9999, rendered four decimal digits |
| 5 | 4 | session 1..0xFFFFFFFF |
| 9 | 1 | sender A=0, B=1 |
| 10 | 2 | global turn sequence 1..65535 |
| 12 | 2 | encoded payload byte length |
| 14 | 2 | uncompressed UTF-8 byte length, max512 |
| 16 | variable | literal UTF-8 or bounded LZSS |
| end−4 | 4 | CRC32 |

Overhead is20 bytes. ACK is20 bytes with both lengths zero. LZSS is selected only if smaller: groups of up to8 tokens preceded by a flag byte, little bit-order in flags; literal flag0 takes1 byte, reference flag1 takes2 big-endian bytes `((distance−1)<<4)|(length−3)`. Distances1..4096, lengths3..18, overlapping references allowed. Raw size max512. Decoder validates expected size, bounds, unused flag bits and trailing bytes.

Wire characters are `VV` + RFC4648-style uppercase unpadded Base32 using `ABCDEFGHIJKLMNOPQRSTUVWXYZ234567`. Canonical trailing bits are required. The resulting characters are encoded with the project's standard International Morse lookup. `VV` is a synchronizing preamble, not text to pass to AI. There are no inter-word spaces within the packet.

## Timing and waveform

`unit_seconds = 1.2 / WPM`. Supported WPM120/300/600/1200. Dot1, dash3, element gap1, character gap3. Leading silence40ms; final silence=max(20ms,12units). Playback code adds scheduling/turnaround outside this waveform duration.

Default carrier4,000Hz, sample rate48kHz. APIs support16k..96kHz; tests include16k/44.1k/48k. A dot must hold at least3 carrier cycles. PCM is sinusoidal amplitude keying with small ramps to avoid hard discontinuities. Decoder uses coherent I/Q sliding-window envelope integration over approximately half a unit, samples at sub-unit hops, and seeks the `VV` prefix before accepting a frame. A long silence completes the frame; CRC and canonical Base32/UTF-8 must pass before delivering it.

No error correction, encryption, cryptographic authentication, adaptive carrier selection or automatic speed negotiation. Both peers must manually agree the same speed and session. This is not a robust general-purpose room modem claim.

## Link and application

Half duplex; A starts with global sequence1 and sends odd turns, B even. A receiver expects2/4/6, B1/3/5. Exact duplicates are ACKed but never delivered twice to AI. Conflicting same-sequence payloads and out-of-order frames reject. The duplicate cache is capped64. Same room/session and opposite sender are required but are not authentication.

On valid DATA, ACK is immediately reserved in the audio queue. Inference starts while waiting for ACK turnaround/playback; actual reply transmission remains queued behind ACK. UI ACK turnaround400ms. The UI ACK timeout is `own ACK waveform ms +1400`. Audio decoder stays muted through local TX and80ms afterward; own mic stays allocated until stop. Up to1 retry in the UI. A valid subsequent DATA turn can implicitly acknowledge the previous local DATA.

Default global conversation limit8, maximum32. Each model response is generated fully before sending; there is no token streaming. MaxReplyBytes default180, configurable32..512. Messages violating the byte limit cause a visible stop, not lossy truncation. The model's token cap is independent of UTF-8 bytes and may yield a short/truncated model response; model quality remains unverified.

## Measurement scope

`fastDuration` is the deterministic signal duration. `fastPcm(...).seconds` differs by up to one output sample due to rounding. It excludes AI latency, audio device buffers, ACK, turnaround and retries. `tools/benchmark_fast.mjs` generates a JSON table plus WAVs and a small synthetic impairment matrix. Numerical PCM decode speed is not acoustic link speed. See TEST_REPORT for failures as well as successes.
