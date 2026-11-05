import { dlopen, FFIType } from "bun:ffi";

// O(1)
// INV: writes the C environment through libc, because WebKitGTK reads getenv() and Bun's process.env assignment does not reach it
function setNativeEnv(name: string, value: string): void {
  const libc = dlopen("libc.so.6", { setenv: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32], returns: FFIType.i32 } });
  libc.symbols.setenv(Buffer.from(`${name}\0`), Buffer.from(`${value}\0`), 0);
  libc.close();
  process.env[name] = value;
}

// INV: imported before electrobun/main so WebKitGTK sees the variable before it initialises
// INV: WebKitGTK's DMA-BUF renderer cannot allocate GBM buffers on NVIDIA under Wayland (blank window), so Linux uses the shared-memory path unless the user sets the variable
if (process.platform === "linux" && process.env.WEBKIT_DISABLE_DMABUF_RENDERER === undefined) {
  setNativeEnv("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
}
