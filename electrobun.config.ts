import type { ElectrobunConfig } from "electrobun";

// The renderer is built by Vite into dist/ (see vite.config.ts); Electrobun
// copies that output into views/mainview. The Bun main process defaults to
// src/bun/index.ts. rclone is bundled as an extra resource for production.
export default {
  app: {
    name: "Kira FTP",
    identifier: "com.kira.ftp",
    version: "0.1.0",
  },
  build: {
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
      "dist/menubar": "views/mainview/menubar",
      // bundled rmate server + editor wrappers, resolved via import.meta.dir/rmate
      "bin/rmate": "bun/rmate",
    },
    watchIgnore: ["dist/**"],
    // Use a prebuilt .iconset (converted via iconutil) instead of an Icon
    // Composer .icon: avoids invoking actool, whose Xcode media frameworks emit
    // noisy (harmless) dyld warnings on every build. Art is inset to ~82% of the
    // canvas so the Dock icon matches the standard macOS size.
    mac: { bundleCEF: false, icons: "assets/icon.iconset" },
    linux: { bundleCEF: false, icon: "assets/icon.iconset/icon_512x512.png" },
    win: { bundleCEF: false },
  },
} satisfies ElectrobunConfig;
