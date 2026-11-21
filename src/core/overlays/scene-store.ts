import { z } from 'zod';
import {
  OverlaysSettingsSchema,
  VideoLayoutSchema,
  type Settings,
  formatZodError,
} from '../config/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { readJsonFile, writeJsonFile } from '../../utils/fs.js';

const MAX_SCENES = 50;

export const OverlaySceneSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Szenen-ID darf nur a-z, 0-9, _ und - enthalten'),
  name: z.string().trim().min(1).max(80),
  overlays: OverlaysSettingsSchema,
  video_layout: VideoLayoutSchema,
  updated_at: z.string(),
});

export const OverlaySceneCreateSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Szenen-ID darf nur a-z, 0-9, _ und - enthalten')
    .optional(),
  name: z.string().trim().min(1).max(80),
  overlays: OverlaysSettingsSchema.optional(),
  video_layout: VideoLayoutSchema.optional(),
});

export const OverlaySceneUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  capture_current: z.boolean().optional(),
  overlays: OverlaysSettingsSchema.optional(),
  video_layout: VideoLayoutSchema.optional(),
});

export type OverlayScene = z.infer<typeof OverlaySceneSchema>;
export type OverlaySceneCreateInput = z.infer<typeof OverlaySceneCreateSchema>;
export type OverlaySceneUpdateInput = z.infer<typeof OverlaySceneUpdateSchema>;

interface SceneStoreFile {
  active_scene_id: string | null;
  scenes: OverlayScene[];
}

function sanitizeOverlays(overlays: Settings['overlays']): Settings['overlays'] {
  const cloned = structuredClone(overlays);
  // Never store chat API secrets inside scene snapshots.
  cloned.chat.api_key = '';
  return cloned;
}

function slugifyName(name: string, existingIds: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'szene';
  if (!existingIds.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base.slice(0, 56)}-${i}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${base.slice(0, 48)}-${Date.now()}`;
}

/** Persistent store for named overlay + video layout scenes (#44). */
export class SceneStore {
  private readonly path: string;
  private data: SceneStoreFile;

  constructor(path: string) {
    this.path = path;
    this.data = this.load();
  }

  private load(): SceneStoreFile {
    const raw = readJsonFile<Partial<SceneStoreFile>>(this.path, {});
    const scenes: OverlayScene[] = [];
    if (Array.isArray(raw.scenes)) {
      for (const entry of raw.scenes) {
        const parsed = OverlaySceneSchema.safeParse(entry);
        if (parsed.success) {
          scenes.push({
            ...parsed.data,
            overlays: sanitizeOverlays(parsed.data.overlays),
          });
        }
      }
    }
    const active =
      typeof raw.active_scene_id === 'string' && scenes.some((s) => s.id === raw.active_scene_id)
        ? raw.active_scene_id
        : null;
    return { active_scene_id: active, scenes };
  }

  private save(): void {
    writeJsonFile(this.path, this.data);
  }

  list(): OverlayScene[] {
    return structuredClone(this.data.scenes);
  }

  activeId(): string | null {
    return this.data.active_scene_id;
  }

  get(id: string): OverlayScene | undefined {
    const found = this.data.scenes.find((scene) => scene.id === id);
    return found ? structuredClone(found) : undefined;
  }

  require(id: string): OverlayScene {
    const found = this.get(id);
    if (!found) throw new NotFoundError(`Szene „${id}“ nicht gefunden`);
    return found;
  }

  setActiveId(id: string | null): void {
    const next = id && this.data.scenes.some((scene) => scene.id === id) ? id : null;
    if (this.data.active_scene_id === next) return;
    this.data.active_scene_id = next;
    this.save();
  }

  create(
    rawInput: unknown,
    fallback: { overlays: Settings['overlays']; video_layout: Settings['video']['layout'] },
  ): OverlayScene {
    if (this.data.scenes.length >= MAX_SCENES) {
      throw new ValidationError(`Maximal ${MAX_SCENES} Szenen erlaubt`);
    }
    const parsed = OverlaySceneCreateSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(`Ungültige Szene: ${formatZodError(parsed.error)}`, parsed.error.issues);
    }
    const existingIds = new Set(this.data.scenes.map((scene) => scene.id));
    const id = parsed.data.id ?? slugifyName(parsed.data.name, existingIds);
    if (existingIds.has(id)) {
      throw new ConflictError(`Szene „${id}“ existiert bereits`);
    }
    const scene: OverlayScene = {
      id,
      name: parsed.data.name,
      overlays: sanitizeOverlays(parsed.data.overlays ?? fallback.overlays),
      video_layout: structuredClone(parsed.data.video_layout ?? fallback.video_layout),
      updated_at: new Date().toISOString(),
    };
    this.data.scenes.push(scene);
    this.save();
    return structuredClone(scene);
  }

  update(
    id: string,
    rawPatch: unknown,
    currentFallback?: { overlays: Settings['overlays']; video_layout: Settings['video']['layout'] },
  ): OverlayScene {
    const index = this.data.scenes.findIndex((scene) => scene.id === id);
    if (index < 0) throw new NotFoundError(`Szene „${id}“ nicht gefunden`);
    const parsed = OverlaySceneUpdateSchema.safeParse(rawPatch);
    if (!parsed.success) {
      throw new ValidationError(`Ungültige Szene: ${formatZodError(parsed.error)}`, parsed.error.issues);
    }
    const existing = this.data.scenes[index]!;
    const nextOverlays = parsed.data.capture_current && currentFallback
      ? sanitizeOverlays(currentFallback.overlays)
      : parsed.data.overlays
        ? sanitizeOverlays(parsed.data.overlays)
        : existing.overlays;
    const nextLayout = parsed.data.capture_current && currentFallback
      ? structuredClone(currentFallback.video_layout)
      : parsed.data.video_layout
        ? structuredClone(parsed.data.video_layout)
        : existing.video_layout;

    const updated: OverlayScene = {
      ...existing,
      name: parsed.data.name ?? existing.name,
      overlays: nextOverlays,
      video_layout: nextLayout,
      updated_at: new Date().toISOString(),
    };
    this.data.scenes[index] = updated;
    this.save();
    return structuredClone(updated);
  }

  remove(id: string): void {
    const index = this.data.scenes.findIndex((scene) => scene.id === id);
    if (index < 0) throw new NotFoundError(`Szene „${id}“ nicht gefunden`);
    this.data.scenes.splice(index, 1);
    if (this.data.active_scene_id === id) {
      this.data.active_scene_id = null;
    }
    this.save();
  }
}
