export {};

declare global {
  interface Window {
    cutlineDesktop?: {
      isDesktop: true;
      platform: string;
      version: () => Promise<string>;
      minimize: () => void;
      maximize: () => void;
      toggleFullscreen: () => void;
      isFullscreen: () => Promise<boolean>;
      onFullscreenChange: (callback: (fullscreen: boolean) => void) => () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
      saveFile: (suggestedName: string, bytes: ArrayBuffer) => Promise<{ canceled: boolean; filePath?: string }>;
      confirmNewProject: () => Promise<boolean>;
      onBeforeClose: (callback: () => Promise<void>) => () => void;
    };
  }
}
