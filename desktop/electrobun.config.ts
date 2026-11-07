import type { ElectrobunConfig } from "electrobun";
import { APP_VERSION } from "../src/shared/version.ts";

export const electrobunConfig = {
  app: { name: "BridgeToGrowth Learning", identifier: "dev.bridgetogrowth.learning", version: APP_VERSION },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "main.ts" },
    copy: { "../dist": "bun/server" },
    linux: { bundleCEF: false, defaultRenderer: "native", icon: "icon.png" },
    // icon.ico and icon.iconset are generated from icon.svg by scripts/make-icons.ts.
    win: { icon: "icon.ico" },
    mac: { icons: "icon.iconset" },
  },
  runtime: { exitOnLastWindowClosed: true },
} satisfies ElectrobunConfig;

export default electrobunConfig;
