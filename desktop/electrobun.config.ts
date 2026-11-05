import type { ElectrobunConfig } from "electrobun";

export const electrobunConfig = {
  app: { name: "BridgeToGrowth Learning", identifier: "dev.bridgetogrowth.learning", version: "0.1.0" },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "main.ts" },
    copy: { "../dist": "bun/server" },
    linux: { bundleCEF: false, defaultRenderer: "native", icon: "icon.png" },
  },
  runtime: { exitOnLastWindowClosed: true },
} satisfies ElectrobunConfig;

export default electrobunConfig;
