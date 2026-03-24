/**
 * Shared video widget utilities
 * Used by both cryptioSaveVideo.ts and cryptioUploadVideo.ts
 */

//@ts-ignore
import { app as rawApp } from "../../../scripts/app.js";
import type { ComfyApp } from "@comfyorg/comfyui-frontend-types";

const app: ComfyApp = rawApp;

export const DEFAULT_VIDEO_SIZE = 256;
const MIN_WIDGET_HEIGHT = 64;

export function fitDimensionsToNodeWidth(
    width: number,
    height: number,
    nodeWidth: number
) {
    const aspectRatio = width / height;
    if (!aspectRatio || Number.isNaN(aspectRatio)) {
        return {
            minHeight: DEFAULT_VIDEO_SIZE,
            minWidth: nodeWidth || DEFAULT_VIDEO_SIZE,
        };
    }

    const minWidth = nodeWidth || DEFAULT_VIDEO_SIZE;
    const minHeight = Math.max(minWidth / aspectRatio, MIN_WIDGET_HEIGHT);

    return { minHeight, minWidth };
}

export interface CreateVideoWidgetOptions {
    widgetName?: string;
    hidden?: boolean;
    videoInfo?: any;
}

/**
 * Create a video preview DOM widget on a node.
 */
export function createVideoWidget(node: any, options: CreateVideoWidgetOptions = {}) {
    const {
        widgetName = "video_preview",
        hidden = false,
        videoInfo,
    } = options;

    let minHeight = DEFAULT_VIDEO_SIZE;
    let minWidth = node.size?.[0] || DEFAULT_VIDEO_SIZE;

    const container = document.createElement("div");
    container.classList.add("comfy-img-preview");

    const widget = node.addDOMWidget(
        widgetName,
        "video-preview",
        container,
        {
            serialize: false,
            hideOnZoom: false,
        }
    );

    widget.computeLayoutSize = () => ({
        minHeight,
        minWidth,
    });

    widget.updateLayout = (videoWidth: number, videoHeight: number) => {
        const nodeWidth = node.size?.[0] || DEFAULT_VIDEO_SIZE;
        const dimensions = fitDimensionsToNodeWidth(
            videoWidth,
            videoHeight,
            nodeWidth
        );
        minHeight = dimensions.minHeight;
        minWidth = dimensions.minWidth;
    };

    // Forward middle-button events to the canvas for panning
    widget.element.addEventListener('pointermove', (event: PointerEvent) => {
        if ((event.buttons & 4) === 4) {
            app.canvas.processMouseMove(event);
        }
    });
    widget.element.addEventListener('pointerdown', (event: PointerEvent) => {
        if ((event.buttons & 4) === 4) {
            app.canvas.processMouseDown(event);
        }
    });

    // Forward wheel events to canvas (block ctrl+wheel for browser zoom)
    widget.element.addEventListener('wheel', (event: WheelEvent) => {
        if (event.ctrlKey) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        event.preventDefault();
        app.canvas.processMouseWheel(event);
    });

    if (videoInfo) {
        widget.videoInfo = videoInfo;
        widget.value = { hidden: false, videoInfo };
    } else {
        widget.value = { hidden };
    }

    if (hidden) {
        widget.element.hidden = true;
    }

    return widget;
}

/**
 * Update a video widget with a decrypted video URL.
 * @param widget The video widget to update
 * @param videoUrl The blob URL of the decrypted video
 */
export function renderVideoInWidget(widget: any, videoUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const video = document.createElement("video");
        video.controls = true;
        video.loop = true;
        video.muted = true;
        video.autoplay = false;
        video.playsInline = true;

        video.onloadedmetadata = () => {
            widget.updateLayout?.(video.videoWidth, video.videoHeight);
            widget.element.hidden = false;
            widget.element.style.overflow = "hidden";

            // Clear previous content
            widget.element.replaceChildren();

            // Add new video
            widget.element.appendChild(video);
            widget.videoElement = video;
            widget.videoUrl = videoUrl;
            widget.value = { ...widget.value, hidden: false };

            app.rootGraph?.setDirtyCanvas(true, false);
            resolve();
        };

        video.onerror = () => reject(new Error("Failed to load video element"));
        video.src = videoUrl;
    });
}

/**
 * Clean up a video widget (pause, revoke URL, clear DOM).
 */
export function clearVideoWidget(widget: any) {
    if (widget.videoElement) {
        widget.videoElement.pause();
        widget.videoElement.src = "";
    }
    if (widget.videoUrl) {
        URL.revokeObjectURL(widget.videoUrl);
    }
    widget.element.hidden = true;
    widget.value = { hidden: true };
    widget.element.replaceChildren();

    app.rootGraph?.setDirtyCanvas(true, false);
}
