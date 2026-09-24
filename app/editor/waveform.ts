export type WaveformData = { waveform: number[]; waveformPeaks: number[] };

/** Preserve both perceived loudness and short transients at timeline resolution. */
export function waveformFromBuffer(buffer: AudioBuffer): WaveformData {
  const bins = Math.min(buffer.length, Math.min(16384, Math.max(1024, Math.ceil(buffer.duration * 96))));
  const sums = new Float64Array(bins);
  const peaks = new Float32Array(bins);
  const counts = new Uint32Array(bins);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const stride = Math.max(1, Math.floor(buffer.length / 16_000_000));
  for (let frame = 0; frame < buffer.length; frame += stride) {
    const bin = Math.min(bins - 1, Math.floor(frame / buffer.length * bins));
    let power = 0;
    let peak = 0;
    for (const channel of channels) {
      const value = channel[frame];
      power += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    sums[bin] += power / channels.length;
    counts[bin]++;
    peaks[bin] = Math.max(peaks[bin], peak);
  }
  return {
    waveform: Array.from(sums, (sum, i) => counts[i] ? Math.sqrt(sum / counts[i]) : 0),
    waveformPeaks: Array.from(peaks),
  };
}

export async function analyzeAudioWaveform(blob: Blob): Promise<WaveformData | null> {
  // Browser audio decoders expand compressed audio in memory. Keep that bounded.
  if (blob.size >= 64 * 1024 * 1024) return null;
  const context = new AudioContext();
  try {
    return waveformFromBuffer(await context.decodeAudioData(await blob.arrayBuffer()));
  } catch {
    return null;
  } finally {
    await context.close();
  }
}

export function waveformColumns(
  values: number[], peaks: number[] | undefined,
  sourceStart: number, sourceEnd: number, duration: number, columns: number,
): { rms: number; peak: number }[] {
  if (!values.length || !Number.isFinite(duration) || duration <= 0 || columns <= 0) return [];
  const count = Math.max(1, Math.floor(columns));
  const result: { rms: number; peak: number }[] = [];
  for (let column = 0; column < count; column++) {
    const start = sourceStart + (sourceEnd - sourceStart) * column / count;
    const end = sourceStart + (sourceEnd - sourceStart) * (column + 1) / count;
    const first = Math.max(0, Math.min(values.length - 1, Math.floor(start / duration * values.length)));
    const last = Math.max(first + 1, Math.min(values.length, Math.ceil(end / duration * values.length)));
    let power = 0;
    let peak = 0;
    for (let i = first; i < last; i++) {
      const value = Math.max(0, values[i] || 0);
      power += value * value;
      peak = Math.max(peak, Math.max(0, peaks?.[i] ?? value));
    }
    result.push({ rms: Math.sqrt(power / (last - first)), peak });
  }
  return result;
}
