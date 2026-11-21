import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonFile, writeJsonFile } from '../../utils/fs.js';
import { isSafeRecordingFilename, recordingsDirectory } from './recording-controller.js';

export type MarkerSource = 'manual' | 'streamdeck' | 'telegram' | 'chat_spike';

export interface RecordingMarker {
  id: string;
  timestamp: string;
  offset_seconds: number;
  label: string;
  source: MarkerSource;
}

export function markersFilePath(dataDir: string, recordingFilename: string): string | null {
  if (!isSafeRecordingFilename(recordingFilename)) return null;
  const markerName = `${recordingFilename}.markers.json`;
  return join(recordingsDirectory(dataDir), markerName);
}

export function readRecordingMarkers(dataDir: string, recordingFilename: string): RecordingMarker[] {
  const path = markersFilePath(dataDir, recordingFilename);
  if (!path || !existsSync(path)) return [];
  const raw = readJsonFile<RecordingMarker[]>(path, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.id === 'string' &&
      typeof item.offset_seconds === 'number',
  );
}

export function addRecordingMarker(
  dataDir: string,
  recordingFilename: string,
  input: {
    offset_seconds: number;
    label?: string;
    source?: MarkerSource;
    timestamp?: string;
  },
): RecordingMarker {
  const path = markersFilePath(dataDir, recordingFilename);
  if (!path) throw new Error(`Ungültiger Aufzeichnungs-Dateiname: ${recordingFilename}`);

  const markers = readRecordingMarkers(dataDir, recordingFilename);
  const offset = Math.max(0, Math.round(input.offset_seconds * 10) / 10);
  const marker: RecordingMarker = {
    id: randomUUID().slice(0, 8),
    timestamp: input.timestamp ?? new Date().toISOString(),
    offset_seconds: offset,
    label: (input.label ?? '').trim() || 'Highlight',
    source: input.source ?? 'manual',
  };

  markers.push(marker);
  markers.sort((a, b) => a.offset_seconds - b.offset_seconds);
  writeJsonFile(path, markers);
  return marker;
}

export function removeRecordingMarker(
  dataDir: string,
  recordingFilename: string,
  markerId: string,
): boolean {
  const path = markersFilePath(dataDir, recordingFilename);
  if (!path || !existsSync(path)) return false;

  const markers = readRecordingMarkers(dataDir, recordingFilename);
  const next = markers.filter((m) => m.id !== markerId);
  if (next.length === markers.length) return false;

  if (next.length === 0) {
    removeMarkersFile(dataDir, recordingFilename);
  } else {
    writeJsonFile(path, next);
  }
  return true;
}

export function removeMarkersFile(dataDir: string, recordingFilename: string): void {
  const path = markersFilePath(dataDir, recordingFilename);
  if (path && existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
}
