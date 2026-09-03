"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, GripVertical, Loader2, RotateCcw, UploadCloud, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  MAX_POST_MEDIA,
  MEDIA_ACCEPT_ATTR,
  checkFile,
  completeUpload,
  formatBytes,
  getAssetStatus,
  probeDimensions,
  putBytes,
  requestUploadUrl,
  type Attachment,
} from "@/lib/media";
import { useSignedMedia } from "./useSignedMedia";

let seq = 0;
const nextLocalId = () => `att-${Date.now()}-${seq++}`;

/**
 * The composer's drag-and-drop + file-picker uploader (prompts/web.md WEB
 * PHASE 8). Per file: client-side MIME/size validation *before* a presigned
 * URL is requested, a real progress bar during the direct-to-storage PUT,
 * then a status poll (`processing` → `ready` / `rejected`). The composer
 * blocks publishing until every row is `ready`. The list is reorderable and
 * its order maps 1:1 to `PostMedia.sortOrder` on save.
 *
 * Controlled: the composer owns the `Attachment[]` so it can seed edit mode
 * and gate the submit button.
 */
export function MediaUploader({
  value,
  onChange,
  disabled = false,
}: {
  value: Attachment[];
  onChange: (next: Attachment[]) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const [dragOver, setDragOver] = useState(false);

  // `valueRef` mirrors `value` but is advanced *synchronously* on every
  // mutation — several async upload callbacks fire between React renders
  // (add row → request URL → PUT → complete → poll), and each must build on
  // the previous change, not on the last committed render.
  const valueRef = useRef(value);
  valueRef.current = value;
  const apply = useCallback(
    (next: Attachment[]) => {
      valueRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  const patch = useCallback(
    (localId: string, partial: Partial<Attachment>) => {
      apply(valueRef.current.map((a) => (a.localId === localId ? { ...a, ...partial } : a)));
    },
    [apply],
  );

  const remove = useCallback(
    (localId: string) => {
      const target = valueRef.current.find((a) => a.localId === localId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      apply(valueRef.current.filter((a) => a.localId !== localId));
    },
    [apply],
  );

  const runUpload = useCallback(
    async (localId: string, file: File) => {
      const kind = checkFile(file);
      if (!kind.ok) {
        patch(localId, { status: "error", error: kind.message });
        return;
      }
      patch(localId, { status: "uploading", progress: 0, error: undefined });

      const dims = await probeDimensions(file, kind.kind);
      patch(localId, { ...dims });

      const intent = await requestUploadUrl({
        mimeType: file.type,
        size: file.size,
        width: dims.width,
        height: dims.height,
        duration: dims.durationSeconds,
      });
      if (!intent.ok) {
        patch(localId, { status: "error", error: intent.message });
        return;
      }
      patch(localId, { assetId: intent.intent.id });

      try {
        await putBytes(intent.intent.uploadUrl, file, {
          onProgress: (fraction) => patch(localId, { progress: fraction }),
        });
      } catch (error) {
        patch(localId, {
          status: "error",
          error: error instanceof Error ? error.message : "Upload failed.",
        });
        return;
      }

      patch(localId, { status: "processing", progress: 1 });
      const completed = await completeUpload(intent.intent.id);
      if (!completed.ok) {
        patch(localId, { status: "error", error: completed.message });
        return;
      }
      await settleStatus(localId, intent.intent.id, completed.asset.status);
    },
    [patch],
  );

  /** Polls `GET /media/:id` until the asset leaves PROCESSING (a real scanner is async — WEB PHASE 14). */
  const settleStatus = useCallback(
    async (localId: string, assetId: string, current: string) => {
      let status = current;
      let attempts = 0;
      while (status === "PROCESSING" && attempts < 40) {
        await new Promise((r) => setTimeout(r, 1_000));
        const check = await getAssetStatus(assetId);
        if (!check.ok) {
          patch(localId, { status: "error", error: check.message });
          return;
        }
        status = check.asset.status;
        attempts += 1;
      }
      if (status === "READY") {
        patch(localId, { status: "ready", progress: 1 });
      } else if (status === "REJECTED") {
        patch(localId, { status: "error", error: "This file was rejected during processing." });
      } else {
        patch(localId, { status: "error", error: "Processing timed out. Try again." });
      }
    },
    [patch],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const room = MAX_POST_MEDIA - valueRef.current.length;
      const picked = Array.from(files).slice(0, Math.max(0, room));
      const created: Attachment[] = picked.map((file) => {
        const check = checkFile(file);
        const localId = nextLocalId();
        return {
          localId,
          assetId: null,
          status: check.ok ? "validating" : "error",
          progress: 0,
          kind: check.ok ? check.kind : "image",
          mimeType: file.type,
          name: file.name,
          size: file.size,
          previewUrl: check.ok ? URL.createObjectURL(file) : null,
          error: check.ok ? undefined : check.message,
        };
      });
      apply([...valueRef.current, ...created]);
      created.forEach((att, i) => {
        if (att.status !== "error") void runUpload(att.localId, picked[i]!);
      });
    },
    [apply, runUpload],
  );

  // Revoke any object URLs still around on unmount.
  useEffect(
    () => () => {
      valueRef.current.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
    },
    [],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = value.findIndex((a) => a.localId === active.id);
    const to = value.findIndex((a) => a.localId === over.id);
    if (from < 0 || to < 0) return;
    apply(arrayMove(value, from, to));
  }

  const atCapacity = value.length >= MAX_POST_MEDIA;

  return (
    <div className="space-y-3">
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !atCapacity) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!disabled && !atCapacity && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed p-6 text-center text-sm transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-surface-muted"
        } ${disabled || atCapacity ? "pointer-events-none opacity-60" : ""}`}
      >
        <UploadCloud className="h-6 w-6 text-muted" aria-hidden />
        <span className="font-medium">
          {atCapacity ? `Attachment limit reached (${MAX_POST_MEDIA})` : "Drag photos or videos here, or click to choose"}
        </span>
        <span className="text-xs text-muted">JPEG, PNG, WebP, GIF, MP4, WebM, MOV</span>
        <input
          id={inputId}
          type="file"
          multiple
          accept={MEDIA_ACCEPT_ATTR}
          disabled={disabled || atCapacity}
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      {value.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={value.map((a) => a.localId)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2" data-testid="attachment-list">
              {value.map((att) => (
                <UploaderRow
                  key={att.localId}
                  att={att}
                  onRemove={() => remove(att.localId)}
                  onRetry={() => {
                    // Retry needs the original File, which we no longer hold —
                    // ask the user to re-add. Keep it simple and honest.
                    remove(att.localId);
                  }}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function UploaderRow({ att, onRemove, onRetry }: { att: Attachment; onRemove: () => void; onRetry: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: att.localId });
  // For a seeded (edit-mode) attachment there's no local File/preview — pull a signed URL.
  const needsSigned = !att.previewUrl && att.assetId !== null && att.status === "ready";
  const signed = useSignedMedia(att.assetId ?? "", needsSigned);
  const thumbUrl = att.previewUrl ?? (signed.status === "ready" ? signed.url : null);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 rounded-lg border border-border bg-surface p-2 ${isDragging ? "opacity-70 shadow-pop" : ""}`}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none text-muted hover:text-foreground"
        aria-label="Reorder attachment"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>

      <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-surface-muted">
        {thumbUrl &&
          (att.kind === "video" ? (
            <video src={thumbUrl} muted playsInline className="h-full w-full object-cover" />
          ) : (
            <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
          ))}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{att.name || "Attachment"}</p>
        <p className="text-xs text-muted">
          {att.status === "uploading" && `Uploading… ${Math.round(att.progress * 100)}%`}
          {att.status === "validating" && "Checking…"}
          {att.status === "processing" && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Checking your file
            </span>
          )}
          {att.status === "ready" && `Ready · ${formatBytes(att.size)}`}
          {att.status === "error" && (
            <span className="inline-flex items-center gap-1 text-danger">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              {att.error ?? "Something went wrong"}
            </span>
          )}
        </p>
        {(att.status === "uploading" || att.status === "processing") && (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${Math.round((att.status === "processing" ? 1 : att.progress) * 100)}%` }}
            />
          </div>
        )}
      </div>

      {att.status === "error" && (
        <button type="button" onClick={onRetry} className="shrink-0 text-muted hover:text-foreground" aria-label="Remove and try again">
          <RotateCcw className="h-4 w-4" aria-hidden />
        </button>
      )}
      <button type="button" onClick={onRemove} className="shrink-0 text-muted hover:text-danger" aria-label="Remove attachment">
        <X className="h-4 w-4" aria-hidden />
      </button>
    </li>
  );
}
