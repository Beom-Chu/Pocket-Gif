export const MAX_FILES = 20;
export const MAX_FILE_BYTES = 500 * 1024 * 1024;
export const MAX_SELECTED_SEGMENTS = 20;
export const TARGET_DURATION_SECONDS = 3;

export type QualityKey = "standard" | "high";

export interface QualityPreset {
  key: QualityKey;
  label: string;
  description: string;
  maxSide: number;
  fps: number;
  colors: number;
}

export interface SegmentRange {
  startTime: number;
  endTime: number;
}

export const QUALITY_PRESETS: Record<QualityKey, QualityPreset> = {
  standard: {
    key: "standard",
    label: "표준",
    description: "긴 변 480px · 10fps",
    maxSide: 480,
    fps: 10,
    colors: 128,
  },
  high: {
    key: "high",
    label: "고화질",
    description: "긴 변 640px · 12fps",
    maxSide: 640,
    fps: 12,
    colors: 128,
  },
};

interface WorkerResponse {
  id: number;
  ok: boolean;
  payload?: unknown;
  error?: string;
}

class GifWorkerClient {
  private worker: Worker;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
      timer: number;
    }
  >();

  constructor() {
    this.worker = new Worker(new URL("../workers/gif.worker.ts", import.meta.url), {
      type: "module",
    });

    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const request = this.pending.get(response.id);
      if (!request) return;
      window.clearTimeout(request.timer);
      this.pending.delete(response.id);

      if (response.ok) request.resolve(response.payload);
      else request.reject(new Error(response.error || "GIF 인코딩에 실패했습니다."));
    };

    this.worker.onerror = (event) => {
      const error = new Error(event.message || "GIF 변환 작업자가 중단되었습니다.");
      this.pending.forEach((request) => {
        window.clearTimeout(request.timer);
        request.reject(error);
      });
      this.pending.clear();
    };
  }

  request<T>(type: string, payload: Record<string, unknown> = {}, transfer: Transferable[] = []) {
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("GIF 인코더가 응답하지 않습니다. Safari 탭을 새로고침해 주세요."));
      }, 30_000);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      this.worker.postMessage({ id, type, ...payload }, transfer);
    });
  }

  terminate() {
    this.worker.terminate();
    const error = new DOMException("변환이 취소되었습니다.", "AbortError");
    this.pending.forEach((request) => {
      window.clearTimeout(request.timer);
      request.reject(error);
    });
    this.pending.clear();
  }
}

export interface ConversionResult {
  blob: Blob;
  width: number;
  height: number;
  frameCount: number;
}

interface ConvertOptions {
  preset: QualityPreset;
  startTime: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

function waitForMediaEvent(
  element: HTMLVideoElement,
  successEvent: keyof HTMLMediaElementEventMap,
  timeoutMs = 20_000,
) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("영상을 불러오는 데 시간이 너무 오래 걸립니다."));
    }, timeoutMs);

    const cleanup = () => {
      window.clearTimeout(timer);
      element.removeEventListener(successEvent, onSuccess);
      element.removeEventListener("error", onError);
    };
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("이 영상 형식을 Safari에서 읽을 수 없습니다."));
    };

    element.addEventListener(successEvent, onSuccess, { once: true });
    element.addEventListener("error", onError, { once: true });
  });
}

async function loadVideo(video: HTMLVideoElement, url: string) {
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    await waitForMediaEvent(video, "loadedmetadata");
  }
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await waitForMediaEvent(video, "loadeddata");
  }
}

async function seekVideo(video: HTMLVideoElement, requestedTime: number) {
  const maximum = Math.max(0, video.duration - 0.001);
  const time = Math.min(Math.max(requestedTime, 0.001), maximum);

  if (Math.abs(video.currentTime - time) > 0.004 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    const ready = waitForMediaEvent(video, "seeked");
    video.currentTime = time;
    await ready;
  }

  // Paused, detached videos may never fire requestVideoFrameCallback on iOS.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function fitWithin(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(2, Math.round(width * scale)),
    height: Math.max(2, Math.round(height * scale)),
  };
}

function frameDelay(index: number, frameCount: number) {
  const totalCentiseconds = TARGET_DURATION_SECONDS * 100;
  const base = Math.floor(totalCentiseconds / frameCount);
  const remainder = totalCentiseconds - base * frameCount;
  return (base + (index < remainder ? 1 : 0)) * 10;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("변환이 취소되었습니다.", "AbortError");
}

export function createSegmentRanges(duration: number): SegmentRange[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  if (duration <= TARGET_DURATION_SECONDS) return [{ startTime: 0, endTime: duration }];

  const ranges: SegmentRange[] = [];
  for (let start = 0; start + TARGET_DURATION_SECONDS <= duration + 0.001; start += TARGET_DURATION_SECONDS) {
    ranges.push({
      startTime: start,
      endTime: Math.min(start + TARGET_DURATION_SECONDS, duration),
    });
  }

  const lastStart = Math.max(0, duration - TARGET_DURATION_SECONDS);
  const previousStart = ranges.at(-1)?.startTime ?? -TARGET_DURATION_SECONDS;
  if (lastStart - previousStart >= 0.5) {
    ranges.push({ startTime: lastStart, endTime: duration });
  }

  return ranges;
}

export async function readVideoDuration(file: File) {
  const video = document.createElement("video");
  const url = URL.createObjectURL(file);

  try {
    await loadVideo(video, url);
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error("영상 길이를 확인할 수 없습니다.");
    }
    return video.duration;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export class VideoThumbnailGenerator {
  private video = document.createElement("video");
  private canvas = document.createElement("canvas");
  private context: CanvasRenderingContext2D | null;
  private url: string;
  private ready: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(file: File) {
    this.url = URL.createObjectURL(file);
    this.video.preload = "auto";
    this.video.muted = true;
    this.video.playsInline = true;
    this.context = this.canvas.getContext("2d", { alpha: false });
  }

  generate(time: number) {
    const task = this.queue.then(async () => {
      if (this.disposed) throw new DOMException("썸네일 생성을 취소했습니다.", "AbortError");
      this.ready ??= loadVideo(this.video, this.url);
      await this.ready;
      if (!this.context) throw new Error("썸네일을 만들 수 없습니다.");

      const size = fitWithin(this.video.videoWidth, this.video.videoHeight, 180);
      this.canvas.width = size.width;
      this.canvas.height = size.height;
      await seekVideo(this.video, time);
      if (this.disposed) throw new DOMException("썸네일 생성을 취소했습니다.", "AbortError");

      this.context.drawImage(this.video, 0, 0, size.width, size.height);
      return await new Promise<Blob>((resolve, reject) => {
        this.canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error("썸네일을 만들 수 없습니다.")),
          "image/jpeg",
          0.72,
        );
      });
    });

    this.queue = task.catch(() => undefined);
    return task;
  }

  dispose() {
    this.disposed = true;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.canvas.width = 1;
    this.canvas.height = 1;
    URL.revokeObjectURL(this.url);
  }
}

export async function convertVideoToGif(
  file: File,
  { preset, startTime, signal, onProgress }: ConvertOptions,
): Promise<ConversionResult> {
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true,
  });
  const sourceUrl = URL.createObjectURL(file);
  const worker = new GifWorkerClient();

  if (!context) {
    URL.revokeObjectURL(sourceUrl);
    worker.terminate();
    throw new Error("이 브라우저에서는 영상 프레임을 처리할 수 없습니다.");
  }

  try {
    throwIfAborted(signal);
    onProgress?.(2);
    await loadVideo(video, sourceUrl);

    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) {
      throw new Error("영상 정보를 읽을 수 없습니다.");
    }

    const size = fitWithin(video.videoWidth, video.videoHeight, preset.maxSide);
    canvas.width = size.width;
    canvas.height = size.height;

    const frameCount = preset.fps * TARGET_DURATION_SECONDS;
    const safeStart = Math.min(
      Math.max(startTime, 0),
      Math.max(0, video.duration - TARGET_DURATION_SECONDS),
    );

    await worker.request("init", {
      width: size.width,
      height: size.height,
      colors: preset.colors,
    });

    for (let index = 0; index < frameCount; index += 1) {
      throwIfAborted(signal);

      const offset = (index + 0.5) / preset.fps;
      const sourceTime = video.duration >= TARGET_DURATION_SECONDS
        ? safeStart + offset
        : offset % video.duration;

      await seekVideo(video, sourceTime);
      context.drawImage(video, 0, 0, size.width, size.height);
      const image = context.getImageData(0, 0, size.width, size.height);
      const buffer = image.data.buffer;

      await worker.request("frame", {
        buffer,
        delay: frameDelay(index, frameCount),
      }, [buffer]);

      onProgress?.(Math.min(96, 5 + Math.round(((index + 1) / frameCount) * 91)));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    throwIfAborted(signal);
    const bytes = await worker.request<ArrayBuffer>("finish");
    onProgress?.(100);

    return {
      blob: new Blob([bytes], { type: "image/gif" }),
      width: size.width,
      height: size.height,
      frameCount,
    };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    canvas.width = 1;
    canvas.height = 1;
    URL.revokeObjectURL(sourceUrl);
    worker.terminate();
  }
}
