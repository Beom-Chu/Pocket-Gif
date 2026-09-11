import {
  AlertCircle,
  Check,
  ChevronRight,
  CircleCheck,
  Download,
  Film,
  Images,
  LoaderCircle,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_SELECTED_SEGMENTS,
  QUALITY_PRESETS,
  QualityKey,
  VideoThumbnailGenerator,
  convertVideoToGif,
  createSegmentRanges,
  readVideoDuration,
} from "@/lib/gif-converter";

type SegmentStatus = "ready" | "queued" | "processing" | "done" | "error";

interface VideoSegment {
  id: string;
  startTime: number;
  endTime: number;
  selected: boolean;
  status: SegmentStatus;
  progress: number;
  thumbnailUrl?: string;
  resultBlob?: Blob;
  resultUrl?: string;
  outputName?: string;
  outputWidth?: number;
  outputHeight?: number;
  error?: string;
}

interface VideoItem {
  id: string;
  file: File;
  duration: number;
  segments: VideoSegment[];
}

interface SegmentCardProps {
  segment: VideoSegment;
  videoName: string;
  disabled: boolean;
  onToggle: () => void;
  onVisible: () => void;
  onSave: () => void;
  onDownload: () => void;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)}MB`;
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function outputName(fileName: string, startTime: number, endTime: number) {
  const base = fileName.replace(/\.[^/.]+$/, "") || "pocket-gif";
  const start = String(Math.floor(startTime)).padStart(3, "0");
  const end = String(Math.ceil(endTime)).padStart(3, "0");
  return `${base}_${start}-${end}.gif`;
}

function isVideo(file: File) {
  const videoExtensions = new Set(["mp4", "mov", "m4v", "webm"]);
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return file.type.startsWith("video/") || videoExtensions.has(extension);
}

function isAndroidChromeBrowser() {
  const userAgent = navigator.userAgent;
  return /Android/i.test(userAgent)
    && /Chrome\/\d+/i.test(userAgent)
    && !/(EdgA|OPR|SamsungBrowser|DuckDuckGo)/i.test(userAgent);
}

function SegmentStatusIcon({ segment }: { segment: VideoSegment }) {
  if (segment.status === "processing") return <LoaderCircle className="size-3.5 animate-spin" />;
  if (segment.status === "done") return <CircleCheck className="size-3.5" />;
  if (segment.status === "error") return <AlertCircle className="size-3.5" />;
  return null;
}

function SegmentCard({
  segment,
  videoName,
  disabled,
  onToggle,
  onVisible,
  onSave,
  onDownload,
}: SegmentCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const requested = useRef(false);

  useEffect(() => {
    if (segment.thumbnailUrl || segment.resultUrl || requested.current) return;
    const node = ref.current;
    if (!node || !("IntersectionObserver" in window)) {
      requested.current = true;
      onVisible();
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        requested.current = true;
        onVisible();
        observer.disconnect();
      }
    }, { rootMargin: "280px" });

    observer.observe(node);
    return () => observer.disconnect();
  }, [onVisible, segment.resultUrl, segment.thumbnailUrl]);

  const statusText = segment.status === "processing"
    ? `${segment.progress}%`
    : segment.status === "queued"
      ? "대기"
      : segment.status === "done"
        ? formatBytes(segment.resultBlob?.size || 0)
        : segment.status === "error"
          ? "실패"
          : segment.selected ? "선택됨" : "선택";

  return (
    <div ref={ref} className={`segment-card ${segment.selected ? "segment-selected" : ""}`}>
      <button
        type="button"
        className="segment-select-button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={segment.selected}
        aria-label={`${videoName} ${formatTime(segment.startTime)}부터 ${formatTime(segment.endTime)} 구간 ${segment.selected ? "선택 해제" : "선택"}`}
      >
        <div className="segment-visual">
          {segment.resultUrl ? (
            <img src={segment.resultUrl} alt={`${videoName} ${formatTime(segment.startTime)} GIF 미리보기`} />
          ) : segment.thumbnailUrl ? (
            <img src={segment.thumbnailUrl} alt={`${videoName} ${formatTime(segment.startTime)} 구간 썸네일`} />
          ) : (
            <div className="thumbnail-loading"><LoaderCircle className="size-5 animate-spin" /></div>
          )}
          <span className="segment-time">{formatTime(segment.startTime)}–{formatTime(segment.endTime)}</span>
          <span className={`segment-check ${segment.selected ? "segment-check-active" : ""}`}>
            {segment.selected && <Check className="size-3.5" strokeWidth={3} />}
          </span>
          {(segment.status === "processing" || segment.status === "queued") && (
            <div className="segment-progress"><span style={{ transform: `scaleX(${segment.progress / 100})` }} /></div>
          )}
        </div>
        <span className={`segment-status status-${segment.status}`}>
          <SegmentStatusIcon segment={segment} /> {statusText}
        </span>
      </button>

      {segment.status === "done" && (
        <div className="segment-actions">
          <button type="button" onClick={onSave}>GIF 저장</button>
          <button type="button" onClick={onDownload} aria-label="GIF 직접 다운로드"><Download className="size-3.5" /></button>
        </div>
      )}
      {segment.error && <p className="segment-error">{segment.error}</p>}
    </div>
  );
}

export default function Home() {
  const [items, setItems] = useState<VideoItem[]>([]);
  const [quality, setQuality] = useState<QualityKey>("standard");
  const [running, setRunning] = useState(false);
  const [readingFiles, setReadingFiles] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const objectUrls = useRef(new Set<string>());
  const generators = useRef(new Map<string, VideoThumbnailGenerator>());
  const thumbnailRequests = useRef(new Set<string>());

  const allSegments = useMemo(() => items.flatMap((item) => item.segments), [items]);
  const selectedSegments = allSegments.filter((segment) => segment.selected);
  const completedResults = items.flatMap((item) => item.segments
    .filter((segment) => segment.status === "done" && segment.resultBlob && segment.outputName)
    .map((segment) => ({ item, segment })));
  const selectedCount = selectedSegments.length;
  const completedSelectedCount = selectedSegments.filter((segment) => segment.status === "done").length;
  const remainingSelectedCount = selectedSegments.filter((segment) => segment.status !== "done").length;
  const currentSegment = selectedSegments.find((segment) => segment.status === "processing");
  const totalProgress = selectedCount
    ? Math.round(selectedSegments.reduce((sum, segment) => sum + segment.progress, 0) / selectedCount)
    : 0;

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && running) {
        toast.warning("변환 중에는 Safari를 화면에 열어두는 것이 안전합니다.");
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [running]);

  useEffect(() => {
    const urls = objectUrls.current;
    const activeGenerators = generators.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      activeGenerators.forEach((generator) => generator.dispose());
    };
  }, []);

  const trackUrl = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    objectUrls.current.add(url);
    return url;
  };

  const releaseUrl = (url?: string) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrls.current.delete(url);
  };

  const updateSegment = (videoId: string, segmentId: string, changes: Partial<VideoSegment>) => {
    setItems((current) => current.map((item) => item.id !== videoId ? item : {
      ...item,
      segments: item.segments.map((segment) => segment.id === segmentId ? { ...segment, ...changes } : segment),
    }));
  };

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selected.length) return;

    const room = MAX_FILES - items.length;
    if (room <= 0) {
      toast.error(`영상은 한 번에 최대 ${MAX_FILES}개까지 선택할 수 있습니다.`);
      return;
    }

    const accepted: File[] = [];
    let rejected = 0;
    selected.slice(0, room).forEach((file) => {
      if (!isVideo(file) || file.size > MAX_FILE_BYTES) rejected += 1;
      else accepted.push(file);
    });
    if (selected.length > room) rejected += selected.length - room;

    if (rejected) {
      toast.warning(`${rejected}개 파일을 제외했습니다. 영상당 500MB, 최대 ${MAX_FILES}개까지 가능합니다.`);
    }
    if (!accepted.length) return;

    setReadingFiles(true);
    for (const file of accepted) {
      try {
        const duration = await readVideoDuration(file);
        const id = `${Date.now()}-${crypto.randomUUID?.() || Math.random()}`;
        const ranges = createSegmentRanges(duration);
        const segments: VideoSegment[] = ranges.map((range, index) => ({
          id: `${id}-segment-${index}`,
          startTime: range.startTime,
          endTime: range.endTime,
          selected: false,
          status: "ready",
          progress: 0,
        }));
        generators.current.set(id, new VideoThumbnailGenerator(file));
        setItems((current) => [...current, { id, file, duration, segments }].slice(0, MAX_FILES));
      } catch (error) {
        toast.error(`${file.name}: ${error instanceof Error ? error.message : "읽을 수 없는 영상입니다."}`);
      }
    }
    setReadingFiles(false);
  };

  const requestThumbnail = async (item: VideoItem, segment: VideoSegment) => {
    const key = `${item.id}:${segment.id}`;
    if (thumbnailRequests.current.has(key) || segment.thumbnailUrl || segment.resultUrl) return;
    thumbnailRequests.current.add(key);

    try {
      const generator = generators.current.get(item.id);
      if (!generator) return;
      const middle = Math.min(item.duration - 0.001, segment.startTime + 1.5);
      const blob = await generator.generate(Math.max(0.001, middle));
      const url = trackUrl(blob);
      updateSegment(item.id, segment.id, { thumbnailUrl: url });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.warn("Thumbnail generation failed", error);
      }
    }
  };

  const removeItem = (id: string) => {
    const target = items.find((item) => item.id === id);
    if (target) {
      target.segments.forEach((segment) => {
        releaseUrl(segment.thumbnailUrl);
        releaseUrl(segment.resultUrl);
      });
    }
    generators.current.get(id)?.dispose();
    generators.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  };

  const clearAll = () => {
    items.forEach((item) => {
      item.segments.forEach((segment) => {
        releaseUrl(segment.thumbnailUrl);
        releaseUrl(segment.resultUrl);
      });
      generators.current.get(item.id)?.dispose();
    });
    generators.current.clear();
    thumbnailRequests.current.clear();
    setItems([]);
  };

  const toggleSegment = (videoId: string, segmentId: string) => {
    if (running) return;
    const current = items.flatMap((item) => item.segments).find((segment) => segment.id === segmentId);
    if (!current) return;
    if (!current.selected && selectedCount >= MAX_SELECTED_SEGMENTS) {
      toast.warning(`한 번에 최대 ${MAX_SELECTED_SEGMENTS}개 구간까지 선택할 수 있습니다.`);
      return;
    }
    updateSegment(videoId, segmentId, {
      selected: !current.selected,
      status: current.status === "error" ? "ready" : current.status,
      error: undefined,
    });
  };

  const changeQuality = (nextQuality: QualityKey) => {
    if (running || nextQuality === quality) return;
    items.forEach((item) => item.segments.forEach((segment) => releaseUrl(segment.resultUrl)));
    setItems((current) => current.map((item) => ({
      ...item,
      segments: item.segments.map((segment) => ({
        ...segment,
        status: "ready",
        progress: 0,
        resultBlob: undefined,
        resultUrl: undefined,
        outputName: undefined,
        outputWidth: undefined,
        outputHeight: undefined,
        error: undefined,
      })),
    })));
    setQuality(nextQuality);
  };

  const requestWakeLock = async () => {
    try {
      if ("wakeLock" in navigator) return await navigator.wakeLock.request("screen");
    } catch {
      // The page still works without a wake lock.
    }
    return null;
  };

  const startConversion = async () => {
    const targets = items.flatMap((item) => item.segments
      .filter((segment) => segment.selected && segment.status !== "done")
      .map((segment) => ({ item, segment })));

    if (!selectedCount) {
      toast.warning("먼저 만들고 싶은 3초 구간을 선택해 주세요.");
      return;
    }
    if (!targets.length) {
      toast.success("선택한 구간이 모두 완성되었습니다.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setItems((current) => current.map((item) => ({
      ...item,
      segments: item.segments.map((segment) =>
        segment.selected && segment.status !== "done"
          ? { ...segment, status: "queued", progress: 0, error: undefined }
          : segment),
    })));

    const wakeLock = await requestWakeLock();
    let successCount = 0;

    try {
      for (const { item, segment } of targets) {
        if (controller.signal.aborted) break;
        updateSegment(item.id, segment.id, { status: "processing", progress: 1 });

        try {
          const result = await convertVideoToGif(item.file, {
            preset: QUALITY_PRESETS[quality],
            startTime: segment.startTime,
            signal: controller.signal,
            onProgress: (progress) => updateSegment(item.id, segment.id, { progress }),
          });
          const resultUrl = trackUrl(result.blob);
          updateSegment(item.id, segment.id, {
            status: "done",
            progress: 100,
            resultBlob: result.blob,
            resultUrl,
            outputName: outputName(item.file.name, segment.startTime, segment.endTime),
            outputWidth: result.width,
            outputHeight: result.height,
          });
          successCount += 1;
        } catch (error) {
          if (controller.signal.aborted) break;
          updateSegment(item.id, segment.id, {
            status: "error",
            progress: 0,
            error: error instanceof Error ? error.message : "변환에 실패했습니다.",
          });
        }
      }

      if (!controller.signal.aborted && successCount > 0) {
        toast.success(`${successCount}개의 GIF 파일을 만들었습니다.`);
      }
    } finally {
      if (controller.signal.aborted) {
        setItems((current) => current.map((item) => ({
          ...item,
          segments: item.segments.map((segment) =>
            segment.status === "processing" || segment.status === "queued"
              ? { ...segment, status: "ready", progress: 0 }
              : segment),
        })));
        toast.message("변환을 중단했습니다.");
      }
      await wakeLock?.release().catch(() => undefined);
      abortRef.current = null;
      setRunning(false);
    }
  };

  const cancelConversion = () => abortRef.current?.abort();

  const findSegment = (videoId: string, segmentId: string) => {
    const item = items.find((candidate) => candidate.id === videoId);
    const segment = item?.segments.find((candidate) => candidate.id === segmentId);
    return item && segment ? { item, segment } : null;
  };

  const downloadSegment = (videoId: string, segmentId: string) => {
    const target = findSegment(videoId, segmentId);
    if (!target?.segment.resultUrl || !target.segment.outputName) return;
    const anchor = document.createElement("a");
    anchor.href = target.segment.resultUrl;
    anchor.download = target.segment.outputName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const saveSegment = async (videoId: string, segmentId: string) => {
    const target = findSegment(videoId, segmentId);
    if (!target?.segment.resultBlob || !target.segment.outputName) return;

    if (isAndroidChromeBrowser()) {
      downloadSegment(videoId, segmentId);
      toast.success("GIF 다운로드를 시작했습니다.");
      return;
    }

    const file = new File([target.segment.resultBlob], target.segment.outputName, { type: "image/gif" });

    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ files: [file], title: target.segment.outputName });
      } else {
        downloadSegment(videoId, segmentId);
        toast.message("GIF 파일을 다운로드했습니다.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("저장하지 못했습니다. 다운로드 아이콘을 이용해 주세요.");
    }
  };

  const saveAllGifs = async () => {
    if (!completedResults.length) return;
    const files = completedResults.map(({ segment }) => new File(
      [segment.resultBlob as Blob],
      segment.outputName as string,
      { type: "image/gif" },
    ));

    try {
      if (isAndroidChromeBrowser()) {
        completedResults.forEach(({ segment }) => {
          if (!segment.resultUrl || !segment.outputName) return;
          const anchor = document.createElement("a");
          anchor.href = segment.resultUrl;
          anchor.download = segment.outputName;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        });
        toast.success(`${files.length}개의 GIF 다운로드를 시작했습니다.`);
        return;
      }

      if (navigator.share && (!navigator.canShare || navigator.canShare({ files }))) {
        await navigator.share({
          files,
          title: `Pocket GIF ${files.length}개`,
          text: `${files.length}개의 GIF 파일`,
        });
        return;
      }

      completedResults.forEach(({ segment }) => {
        if (!segment.resultUrl || !segment.outputName) return;
        const anchor = document.createElement("a");
        anchor.href = segment.resultUrl;
        anchor.download = segment.outputName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      });
      toast.success(`${files.length}개의 GIF 다운로드를 시작했습니다.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("일괄 저장하지 못했습니다. 각 GIF의 저장 버튼을 이용해 주세요.");
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-14">
      <header className="safe-top relative z-20">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 md:px-8">
          <a href="#top" className="group flex items-center gap-3" aria-label="Pocket GIF 홈">
            <span className="logo-mark" aria-hidden="true"><span /></span>
            <span className="display-face text-[17px] font-extrabold tracking-[-0.03em]">Pocket GIF</span>
          </a>
          <div className="privacy-pill">
            <LockKeyhole className="size-3.5" aria-hidden="true" />
            <span>기기에서만 처리</span>
          </div>
        </div>
      </header>

      <main id="top" className="relative z-10 mx-auto w-full max-w-6xl px-5 md:px-8">
        <section className="grid items-end gap-8 pb-10 pt-8 md:grid-cols-[1.15fr_0.85fr] md:pb-16 md:pt-16">
          <div className="max-w-3xl">
            <div className="eyebrow"><Sparkles className="size-3.5" /> 마음에 드는 3초만</div>
            <h1 className="display-face mt-5 text-[clamp(3rem,7vw,5.4rem)] font-extrabold leading-[0.91] tracking-[-0.075em]">
              영상을 나누고,<br /><span className="coral-text">순간을 고르세요.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[15px] font-medium leading-7 text-muted-foreground md:text-lg">
              3초 구간마다 썸네일을 보여드립니다. 원하는 구간만 골라 각각 GIF 파일로 저장하세요.
            </p>
            <div className="dedication-card" aria-label="지선이를 위한 Pocket GIF 헌정 문구">
              <span className="dedication-icon" aria-hidden="true">♡</span>
              <span className="flex flex-col gap-0.5 text-left">
                <strong>지선이를 위해 만들었어요.</strong>
                <span>작은 순간을 더 오래 간직할 수 있도록</span>
              </span>
            </div>
          </div>
          <div className="hidden justify-end md:flex">
            <div className="privacy-card">
              <ShieldCheck className="size-6 text-primary" />
              <div>
                <p className="font-bold">원본은 아이폰 밖으로 나가지 않아요.</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">썸네일과 GIF 모두 현재 브라우저 안에서 생성됩니다.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
          <div className="space-y-5 lg:sticky lg:top-6">
            <label className={`upload-zone ${running ? "pointer-events-none opacity-60" : ""}`}>
              <input
                ref={inputRef}
                className="sr-only"
                type="file"
                accept="video/*,.mov,.m4v,.mp4,.webm"
                multiple
                disabled={running || readingFiles || items.length >= MAX_FILES}
                onChange={handleFiles}
              />
              <span className="upload-icon"><Upload className="size-6" /></span>
              <span className="display-face mt-5 text-xl font-bold tracking-[-0.035em]">
                {readingFiles ? "영상 분석 중…" : items.length ? "영상 더 추가하기" : "영상 선택하기"}
              </span>
              <span className="mt-2 text-center text-sm leading-6 text-muted-foreground">
                사진 앱 또는 파일에서 선택<br />최대 {MAX_FILES}개 · 파일당 500MB
              </span>
              <span className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-xs font-bold text-background">
                <Plus className="size-3.5" /> {items.length}/{MAX_FILES}
              </span>
            </label>

            <div className="panel p-5 md:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="section-label">출력 설정</p>
                  <h2 className="mt-1 text-lg font-extrabold tracking-[-0.03em]">GIF 품질</h2>
                </div>
                <span className="fixed-badge">구간당 3초 · 128색</span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="GIF 화질">
                {Object.values(QUALITY_PRESETS).map((preset) => {
                  const active = quality === preset.key;
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={running}
                      onClick={() => changeQuality(preset.key)}
                      className={`quality-option ${active ? "quality-option-active" : ""}`}
                    >
                      <span className="flex items-center justify-between">
                        <span className="font-extrabold">{preset.label}</span>
                        <span className={`check-dot ${active ? "check-dot-active" : ""}`}>
                          {active && <Check className="size-3" strokeWidth={3} />}
                        </span>
                      </span>
                      <span className="mt-2 block text-left text-xs leading-5 text-muted-foreground">{preset.description}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 flex items-start gap-3 rounded-2xl bg-[#F4F1EA] p-4">
                <Zap className="mt-0.5 size-4 shrink-0 text-[#E45A3D]" />
                <p className="text-xs font-medium leading-5 text-[#685F54]">최대 {MAX_SELECTED_SEGMENTS}개 구간을 골라 한 번에 하나씩 안전하게 변환합니다.</p>
              </div>
            </div>
          </div>

          <div className="panel min-h-[430px] overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/80 px-5 py-5 md:px-6">
              <div>
                <p className="section-label">구간 선택</p>
                <h2 className="mt-1 text-xl font-extrabold tracking-[-0.04em]">
                  {items.length ? `${selectedCount}개 구간 선택됨` : "아직 영상이 없어요"}
                </h2>
              </div>
              {items.length > 0 && !running && (
                <button className="icon-text-button" type="button" onClick={clearAll}>
                  <Trash2 className="size-4" /> 전체 삭제
                </button>
              )}
            </div>

            {!items.length ? (
              <div className="flex min-h-[340px] flex-col items-center justify-center px-8 py-14 text-center">
                <div className="empty-film" aria-hidden="true"><Images className="size-8" /></div>
                <p className="mt-5 font-extrabold tracking-[-0.02em]">3초 구간이 여기에 펼쳐집니다.</p>
                <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">영상을 선택하면 각 구간의 썸네일을 차례로 준비합니다.</p>
                <button
                  type="button"
                  className="mt-6 text-sm font-extrabold text-primary underline decoration-primary/30 underline-offset-4"
                  onClick={() => inputRef.current?.click()}
                >
                  첫 영상 선택하기
                </button>
              </div>
            ) : (
              <div className="divide-y divide-border/75">
                {items.map((item) => (
                  <article key={item.id} className="video-section">
                    <div className="flex items-start justify-between gap-3 px-5 md:px-6">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="video-file-icon"><Film className="size-4" /></span>
                          <h3 className="truncate text-[14px] font-extrabold tracking-[-0.02em]">{item.file.name}</h3>
                        </div>
                        <p className="mt-1.5 pl-8 text-xs font-medium text-muted-foreground">
                          {formatTime(item.duration)} · {formatBytes(item.file.size)} · {item.segments.length}개 구간
                        </p>
                      </div>
                      {!running && (
                        <button type="button" className="remove-button" onClick={() => removeItem(item.id)} aria-label={`${item.file.name} 삭제`}>
                          <X className="size-4" />
                        </button>
                      )}
                    </div>

                    <div className="segment-scroll-hint px-5 md:px-6">
                      <span>옆으로 넘겨 구간 확인</span><ChevronRight className="size-3.5" />
                    </div>
                    <div className="segment-strip" role="list" aria-label={`${item.file.name} 3초 구간 목록`}>
                      {item.segments.map((segment) => (
                        <div role="listitem" key={segment.id}>
                          <SegmentCard
                            segment={segment}
                            videoName={item.file.name}
                            disabled={running}
                            onToggle={() => toggleSegment(item.id, segment.id)}
                            onVisible={() => requestThumbnail(item, segment)}
                            onSave={() => saveSegment(item.id, segment.id)}
                            onDownload={() => downloadSegment(item.id, segment.id)}
                          />
                        </div>
                      ))}
                      <div className="segment-endcap" aria-hidden="true"><CircleCheck className="size-5" /><span>끝</span></div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            ["01", "3초씩 나누기", "긴 영상도 00:00–00:03처럼 시간과 썸네일로 나눠 보여드립니다."],
            ["02", "고른 구간만", "선택하지 않은 구간은 GIF로 만들지 않아 시간과 배터리를 아낍니다."],
            ["03", "개별·일괄 저장", "ZIP 없이 각 .gif 파일을 따로 저장하거나 완성된 결과를 한 번에 공유합니다."],
          ].map(([number, title, body]) => (
            <div key={number} className="info-card">
              <span className="display-face text-xs font-black text-primary">{number}</span>
              <h3 className="mt-4 font-extrabold tracking-[-0.025em]">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>

        <footer className="mt-10 flex flex-col gap-3 border-t border-border py-8 text-xs font-medium text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p>Safari 공유 버튼 → 홈 화면에 추가하면 앱처럼 사용할 수 있습니다.</p>
          <p>원본 업로드 없음 · ZIP 없음 · 개별·일괄 GIF 저장</p>
        </footer>
      </main>

      {items.length > 0 && (
        <div className="action-dock-wrap" aria-live="polite">
          <div className="action-dock">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="truncate">
                  {running
                    ? currentSegment ? `${formatTime(currentSegment.startTime)} 구간 변환 중` : "다음 구간 준비 중"
                    : completedResults.length && remainingSelectedCount === 0
                      ? `${completedResults.length}개 GIF 저장 준비`
                      : selectedCount ? `${selectedCount}개 구간 선택 · ${completedSelectedCount}개 완료` : "썸네일을 눌러 구간 선택"}
                </span>
                <span className="ml-3 shrink-0 text-muted-foreground">
                  {running ? `${totalProgress}%` : `${selectedCount}/${MAX_SELECTED_SEGMENTS}`}
                </span>
              </div>
              {running && <div className="progress-track mt-2"><span style={{ transform: `scaleX(${totalProgress / 100})` }} /></div>}
            </div>
            {running ? (
              <button type="button" className="dock-button dock-button-cancel" onClick={cancelConversion}>
                <X className="size-4" /> 중단
              </button>
            ) : completedResults.length > 0 && remainingSelectedCount === 0 ? (
              <button type="button" className="dock-button dock-button-save-all" onClick={saveAllGifs}>
                <Download className="size-4" /> GIF {completedResults.length}개 일괄 저장
              </button>
            ) : (
              <button type="button" className="dock-button" onClick={startConversion} disabled={!selectedCount || readingFiles}>
                <Sparkles className="size-4" /> {selectedCount ? `${remainingSelectedCount}개 GIF 만들기` : "구간 선택"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
