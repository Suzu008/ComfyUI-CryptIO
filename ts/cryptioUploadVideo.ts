//@ts-ignore
import { app as rawApp } from "../../scripts/app.js";
//@ts-ignore
import { api as rawApi } from "../../scripts/api.js";
import type {
    ComfyApp,
    ComfyApi,
    ComfyNodeDef,
} from "@comfyorg/comfyui-frontend-types";

import { exchangeKeys } from "./utils/cryptoKeys.js";
import { encryptFileWithServerKey } from "./utils/cryptoUtils.js";
import { loadEncryptedVideoFromFilename } from "./utils/videoLoader.js";

const app: ComfyApp = rawApp;
const api: ComfyApi = rawApi;

const DEFAULT_VIDEO_SIZE = 256;
const MIN_WIDGET_HEIGHT = 64;

function fitDimensionsToNodeWidth(
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

/**
 * Create video preview widget
 */
function createVideoWidget(node: any) {
    let minHeight = DEFAULT_VIDEO_SIZE;
    let minWidth = node.size?.[0] || DEFAULT_VIDEO_SIZE;

    const container = document.createElement("div");
    container.classList.add("comfy-img-preview");

    const widget = node.addDOMWidget(
        "video_preview",
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

    widget.element.addEventListener('pointermove', (event: PointerEvent) => {
        if ((event.buttons & 4) === 4) {
            app.canvas.processMouseMove(event)
        }
    })
    widget.element.addEventListener('pointerdown', (event: PointerEvent) => {
        if ((event.buttons & 4) === 4) {
            app.canvas.processMouseDown(event)
        }
    })


    widget.element.addEventListener('wheel', (event: WheelEvent) => {

        if (event.ctrlKey) {
            event.preventDefault()
            event.stopPropagation()
            return
        }

        event.preventDefault()
        app.canvas.processMouseWheel(event)
    })

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

    widget.value = { hidden: true };
    widget.element.hidden = true;

    return widget;
}

/**
 * Update video preview widget with decrypted video
 */
async function updateVideoWidget(widget: any, filename: string) {
    try {
        const videoUrl = await loadEncryptedVideoFromFilename(filename);

        // Create video element
        const video = document.createElement("video");
        video.controls = true;
        video.loop = true;
        video.muted = true;
        video.autoplay = false;
        video.style.width = "100%";
        video.style.height = "auto";

        video.onloadedmetadata = () => {
            widget.updateLayout?.(video.videoWidth, video.videoHeight);
            widget.element.hidden = false;
            widget.element.style.overflow = "hidden";

            // Clear previous content
            while (widget.element.firstChild) {
                widget.element.removeChild(widget.element.firstChild);
            }

            // Add new video
            widget.element.appendChild(video);
            widget.videoElement = video;
            widget.videoUrl = videoUrl;
            widget.value = { hidden: false };

            app.rootGraph?.setDirtyCanvas(true, false);
        };

        video.src = videoUrl;
    } catch (error) {
        console.error("Failed to decrypt video for preview:", error);
        throw error;
    }
}

/**
 * Clear video preview widget
 */
function clearVideoWidget(widget: any) {
    if (widget.videoElement) {
        widget.videoElement.pause();
        widget.videoElement.src = "";
    }
    if (widget.videoUrl) {
        URL.revokeObjectURL(widget.videoUrl);
    }
    widget.element.hidden = true;
    widget.value = { hidden: true };

    while (widget.element.firstChild) {
        widget.element.removeChild(widget.element.firstChild);
    }

    app.rootGraph?.setDirtyCanvas(true, false);
}

/**
 * Upload encrypted video to server (encrypted with server public key)
 * @param file File to upload
 * @returns Server response
 */
async function uploadEncryptedVideo(file: File): Promise<any> {
    console.log("Encrypting and uploading video:", file.name);

    // Encrypt file (use server public key, or directly read if already encrypted with server public key)
    const encryptedData = file?.name?.endsWith(".encrypted")
        ? new Uint8Array(await file.arrayBuffer())
        : await encryptFileWithServerKey(file);

    // Create FormData
    const formData = new FormData();
    const encryptedBlob = new Blob([new Uint8Array(encryptedData)], {
        type: "application/octet-stream",
    });
    formData.append("image", encryptedBlob, file.name);

    // Upload to server
    const response = await fetch("/cryptio/upload_encrypted", {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
    }

    return await response.json();
}

/**
 * Handle video file upload to node
 * @param node Node instance
 * @param file File to upload
 * @param app ComfyUI App instance
 */
async function handleVideoUpload(node: any, file: File, app: ComfyApp) {
    try {
        // Upload encrypted video
        const result = await uploadEncryptedVideo(file);

        // Update video widget value
        const videoWidget = node.widgets.find(
            (w: any) => w.name === "video"
        );
        if (videoWidget) {
            videoWidget.value = result.name;
        }

        // Update preview
        const previewWidget = node.widgets.find(
            (w: any) => w.type === "video-preview"
        );
        if (previewWidget) {
            await updateVideoWidget(previewWidget, result.name);
        }

        app.rootGraph?.setDirtyCanvas(true, false);
    } catch (error) {
        console.error("Upload error:", error);
        alert("Failed to upload encrypted video: " + error);
    }
}

// Register extension
app.registerExtension({
    name: "cryptio.UploadVideoCryptIO",
    async setup() {
        // Exchange keys on initialization (if not already done)
        try {
            await exchangeKeys();
            console.log("CryptIO: Keys exchanged successfully for video upload");
        } catch (error) {
            console.error("CryptIO: Failed to exchange keys:", error);
        }
    },
    async beforeRegisterNodeDef(
        nodeType: any,
        nodeData: ComfyNodeDef,
        app: ComfyApp
    ) {
        if (nodeType.comfyClass === "UploadVideoCryptIO") {
            // Add custom upload widget
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function (this: any) {
                const r = onNodeCreated?.apply(this, arguments);

                // Remove default upload widget
                this.removeWidgetByName("upload");

                // Add upload button widget
                const uploadWidget = this.addWidget(
                    "button",
                    "cryptio-upload-video",
                    "video",
                    () => {
                        const fileInput = document.createElement("input");
                        fileInput.type = "file";
                        fileInput.accept = "video/*,.encrypted";
                        fileInput.style.display = "none";
                        document.body.appendChild(fileInput);

                        fileInput.onchange = async () => {
                            if (fileInput.files && fileInput.files.length > 0) {
                                const file = fileInput.files[0];
                                await handleVideoUpload(this, file, app);
                            }
                            document.body.removeChild(fileInput);
                        };

                        fileInput.click();
                    }
                );
                uploadWidget.label = "choose video to upload";

                // Create video preview widget
                const previewWidget = createVideoWidget(this);

                // Update preview when video value changes
                const videoWidget = this.widgets.find((w: any) => w.name === "video");
                if (videoWidget) {
                    const originalCallback = videoWidget.callback;

                    // Initial preview update
                    if (videoWidget.value && videoWidget.value.endsWith(".encrypted")) {
                        updateVideoWidget(previewWidget, videoWidget.value).catch(console.error);
                    }

                    videoWidget.callback = async function (this: any, value: any) {
                        if (originalCallback) {
                            originalCallback.call(this, value);
                        }

                        if (value && value.endsWith(".encrypted")) {
                            await updateVideoWidget(previewWidget, value);
                        } else {
                            clearVideoWidget(previewWidget);
                        }
                    };
                }

                // Add Drag and Drop support
                this.onDragOver = function (e: DragEvent) {
                    if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'copy';
                        return true;
                    }
                    return false;
                };

                this.onDragDrop = async function (e: DragEvent) {
                    if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) {
                        return false;
                    }

                    e.preventDefault();
                    e.stopPropagation();

                    const file = e.dataTransfer.files[0];

                    // Check if it's a video file
                    if (!file.type.startsWith('video/') && !file.name.endsWith('.encrypted')) {
                        alert('Please drop a video file');
                        return false;
                    }

                    await handleVideoUpload(this, file, app);
                    return true;
                };

                // Add Paste support
                this.pasteFiles = async function (files: File[]) {
                    for (const file of files) {
                        if (!file.type.startsWith('video/')) {
                            continue;
                        }
                        await handleVideoUpload(this, file, app);
                        return true;
                    }
                };

                return r;
            };

            // Cleanup on node removal
            const onRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function () {
                // Clean up video widget
                const videoWidget = this.widgets?.find((w: any) =>
                    w.type === "video-preview"
                );

                if (videoWidget) {
                    clearVideoWidget(videoWidget);
                }

                if (onRemoved) {
                    onRemoved.apply(this, arguments);
                }
            };
        }
    },
});
