export class FfmpegProgress {
  frame: number | null = null;
  fps: number | null = null;
  bitrateKbps: number | null = null;
  totalSize: number | null = null;
  outTimeUs: number | null = null;
  speed: string | null = null;
  droppedFrames = 0;
  lastUpdate: Date | null = null;

  reset(): void {
    this.frame = null;
    this.fps = null;
    this.bitrateKbps = null;
    this.totalSize = null;
    this.outTimeUs = null;
    this.speed = null;
    this.droppedFrames = 0;
    this.lastUpdate = null;
  }

  push(line: string): void {
    const separator = line.indexOf('=');
    if (separator <= 0) return;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    switch (key) {
      case 'frame':
        this.frame = Number(value) || 0;
        break;
      case 'fps':
        this.fps = parseFloat(value) || 0;
        this.lastUpdate = new Date();
        break;
      case 'bitrate': {
        const match = /^([\d.]+)\s*kbits\/s$/i.exec(value);
        this.bitrateKbps = match ? Number(match[1]) : null;
        this.lastUpdate = new Date();
        break;
      }
      case 'total_size':
        this.totalSize = Number(value) || 0;
        break;
      case 'out_time_us':
      case 'out_time_ms':
        this.outTimeUs = Number(value) || 0;
        break;
      case 'speed':
        this.speed = value === 'N/A' ? null : value;
        break;
      case 'drop_frames':
        this.droppedFrames = Number(value) || 0;
        break;
      case 'progress':
        if (value === 'continue' || value === 'end') this.lastUpdate = new Date();
        break;
      default:
        break;
    }
  }
}
