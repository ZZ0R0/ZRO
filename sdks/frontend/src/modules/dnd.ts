/**
 * @zro/dnd — Drag and drop across iframes.
 *
 * Coordinates drag-and-drop operations between apps running in different
 * iframes. The shell acts as coordinator: the source app initiates a drag,
 * the shell draws a ghost element over all iframes, and the target app
 * receives the drop data.
 *
 * In standalone mode, provides standard HTML5 DnD wrappers.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
} from '../core/types.js';

// ── Types ────────────────────────────────────────────────

export interface DragData {
  /** MIME type of the dragged content (e.g. 'application/zro-file'). */
  type: string;
  /** Arbitrary payload data. */
  data: unknown;
  /** Optional display label for the ghost element. */
  label?: string;
}

export interface DropZone {
  /** Element to attach drop zone behavior to. */
  element: HTMLElement;
  /** Accepted drag types (empty = accept all). */
  acceptTypes?: string[];
  /** Handler called when data is dropped. */
  onDrop: (data: DragData) => void;
  /** Optional handler for drag-enter (for visual feedback). */
  onDragEnter?: () => void;
  /** Optional handler for drag-leave. */
  onDragLeave?: () => void;
}

export interface DndAPI {
  /** Start a drag operation from a source element. */
  startDrag(element: HTMLElement, data: DragData): void;

  /** Register a drop zone. Returns a cleanup function. */
  registerDropZone(zone: DropZone): () => void;

  /** Cancel any active drag operation. */
  cancelDrag(): void;

  /** Whether a drag is currently active. */
  readonly isDragging: boolean;
}

// ── Module factory ───────────────────────────────────────

export const dndModule: ZroModuleFactory = () => {
  let _isDragging = false;
  let _currentDragData: DragData | null = null;
  let _dropZones: Set<DropZone> = new Set();
  let _messageHandler: ((e: MessageEvent) => void) | null = null;
  let _mousedownHandler: ((e: MouseEvent) => void) | null = null;

  const mod: ZroModule = {
    meta: {
      name: 'dnd',
      version: '0.1.0',
      description: 'Drag and drop across iframes',
      category: 'ux',
      dependencies: [],
    },

    init(ctx: ZroModuleContext): DndAPI {
      let isInShell: boolean;
      try {
        isInShell = window !== window.parent;
      } catch (_) {
        isInShell = true;
      }

      // Listen for drag events from shell
      _messageHandler = (e: MessageEvent) => {
        if (!e.data) return;

        switch (e.data.type) {
          case 'zro:dnd:dragover': {
            // Shell tells us something is being dragged over our iframe
            const dragData = e.data.dragData as DragData;
            for (const zone of _dropZones) {
              if (!zone.acceptTypes?.length || zone.acceptTypes.includes(dragData.type)) {
                zone.onDragEnter?.();
              }
            }
            break;
          }

          case 'zro:dnd:dragleave': {
            for (const zone of _dropZones) {
              zone.onDragLeave?.();
            }
            break;
          }

          case 'zro:dnd:drop': {
            const dropData = e.data.dragData as DragData;
            for (const zone of _dropZones) {
              if (!zone.acceptTypes?.length || zone.acceptTypes.includes(dropData.type)) {
                try { zone.onDrop(dropData); } catch (_) { /* noop */ }
              }
            }
            _isDragging = false;
            _currentDragData = null;
            break;
          }

          case 'zro:dnd:cancel': {
            _isDragging = false;
            _currentDragData = null;
            for (const zone of _dropZones) {
              zone.onDragLeave?.();
            }
            break;
          }
        }
      };
      window.addEventListener('message', _messageHandler);

      const api: DndAPI = {
        startDrag(element: HTMLElement, data: DragData): void {
          _isDragging = true;
          _currentDragData = data;

          if (isInShell) {
            // Get bounding rect relative to viewport for ghost positioning
            const rect = element.getBoundingClientRect();
            parent.postMessage({
              type: 'zro:dnd:start',
              dragData: data,
              origin: {
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height,
              },
            }, '*');
          } else {
            // Standalone: use HTML5 drag API
            element.draggable = true;
            const dragstartHandler = (e: DragEvent) => {
              e.dataTransfer?.setData('application/json', JSON.stringify(data));
            };
            element.addEventListener('dragstart', dragstartHandler, { once: true });
          }
        },

        registerDropZone(zone: DropZone): () => void {
          _dropZones.add(zone);

          // Standalone: also register HTML5 drop handlers
          const el = zone.element;
          const dragoverHandler = (e: DragEvent) => { e.preventDefault(); zone.onDragEnter?.(); };
          const dragleaveHandler = () => zone.onDragLeave?.();
          const dropHandler = (e: DragEvent) => {
            e.preventDefault();
            zone.onDragLeave?.();
            const raw = e.dataTransfer?.getData('application/json');
            if (raw) {
              try {
                const data = JSON.parse(raw) as DragData;
                zone.onDrop(data);
              } catch (_) { /* invalid */ }
            }
          };

          el.addEventListener('dragover', dragoverHandler);
          el.addEventListener('dragleave', dragleaveHandler);
          el.addEventListener('drop', dropHandler);

          return () => {
            _dropZones.delete(zone);
            el.removeEventListener('dragover', dragoverHandler);
            el.removeEventListener('dragleave', dragleaveHandler);
            el.removeEventListener('drop', dropHandler);
          };
        },

        cancelDrag(): void {
          if (_isDragging) {
            _isDragging = false;
            _currentDragData = null;
            if (isInShell) {
              parent.postMessage({ type: 'zro:dnd:cancel' }, '*');
            }
          }
        },

        get isDragging(): boolean {
          return _isDragging;
        },
      };

      return api;
    },

    destroy(): void {
      if (_messageHandler) {
        window.removeEventListener('message', _messageHandler);
        _messageHandler = null;
      }
      _dropZones.clear();
      _isDragging = false;
      _currentDragData = null;
    },
  };

  return mod;
};
