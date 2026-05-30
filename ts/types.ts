/**
 * Custom properties for CryptIO nodes to track resources and state.
 */
export interface CryptIONode {
    // Custom properties must be explicitly defined here for safety
    _cryptioPreviewUrl?: string | null;
    _cryptioBlobUrls?: string[];
    updatePreview?: (filename: string) => Promise<void>;

    // ComfyUI / LiteGraph properties
    size: [number, number];
    widgets: any[];
    imgs?: HTMLImageElement[];
    images?: Array<{
        filename: string;
        subfolder: string;
        type: string;
    }>;
    node?: CryptIONode; // Some callbacks are called on widgets with a reference to the node

    // Methods
    addDOMWidget: (name: string, type: string, element: HTMLElement, options?: any) => any;
    removeWidget: (widget: any) => void;
    addWidget: (type: string, name: string, value: any, callback?: any, options?: any) => any;
    
    // Lifecycle hooks
    onExecuted?: (message: any) => void;
    onRemoved?: () => void;
    onNodeCreated?: () => void;
    onDragOver?: (e: DragEvent) => boolean;
    onDragDrop?: (e: DragEvent) => Promise<boolean>;
    pasteFiles?: (files: File[]) => Promise<boolean | void>;

    // Allow for other ComfyUI/LiteGraph properties
    [key: string]: any;
}

/**
 * Service Worker status reported via sync message.
 */
export interface SWStatus {
    ready: boolean;
    interceptEnabled: boolean;
    keys: {
        client: { loaded: boolean; fingerprint: string | null };
        server: { loaded: boolean; fingerprint: string | null };
    };
    lastError: string | null;
}

/**
 * Custom properties for Video Preview widgets.
 */
export interface VideoPreviewWidget {
    type: string;
    name: string;
    element: HTMLElement;
    value: any;
    videoElement?: HTMLVideoElement;
    videoUrl?: string;
    videoInfo?: any;
    computeLayoutSize?: () => { minHeight: number; minWidth: number };
    updateLayout?: (width: number, height: number) => void;
    [key: string]: any;
}

/**
 * ComfyUI App instance with extra methods used in CryptIO.
 */
export interface CryptIOApp {
    canvas: any;
    rootGraph: any;
    registerExtension: (extension: any) => void;
    [key: string]: any;
}
