/// <reference lib="webworker" />

import { GIFEncoder, applyPalette, quantize } from "gifenc";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let encoder: ReturnType<typeof GIFEncoder> | null = null;
let width = 0;
let height = 0;
let colors = 128;

function respond(id: number, payload?: unknown, transfer: Transferable[] = []) {
  scope.postMessage({ id, ok: true, payload }, transfer);
}

function fail(id: number, error: unknown) {
  scope.postMessage({
    id,
    ok: false,
    error: error instanceof Error ? error.message : "GIF 인코딩에 실패했습니다.",
  });
}

scope.onmessage = (event: MessageEvent) => {
  const { id, type } = event.data as { id: number; type: string };

  try {
    if (type === "init") {
      width = Number(event.data.width);
      height = Number(event.data.height);
      colors = Number(event.data.colors) || 128;
      encoder = GIFEncoder();
      respond(id);
      return;
    }

    if (!encoder || !width || !height) {
      throw new Error("GIF 인코더가 준비되지 않았습니다.");
    }

    if (type === "frame") {
      const rgba = new Uint8ClampedArray(event.data.buffer as ArrayBuffer);
      const palette = quantize(rgba, colors, { format: "rgb565" });
      const indexed = applyPalette(rgba, palette, "rgb565");
      encoder.writeFrame(indexed, width, height, {
        palette,
        delay: Number(event.data.delay),
        repeat: 0,
      });
      respond(id);
      return;
    }

    if (type === "finish") {
      encoder.finish();
      const bytes = encoder.bytes();
      const output = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      respond(id, output, [output]);
      encoder = null;
      return;
    }

    throw new Error("알 수 없는 변환 명령입니다.");
  } catch (error) {
    fail(id, error);
  }
};

export {};
