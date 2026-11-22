/* KAI TỒ VIDEO CUTTER — FFmpeg.wasm Worker (Tương thích 100% GitHub Pages) */

const CORE_CDNS = [
  "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd",
  "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd"
];

let ffmpeg = null;
let mountedInputPath = null;
let isWorkerFSMounted = false;
let currentCutDuration = 0;
let lastEncodedTimeSec = 0;
let logBuffer = [];

function formatFFmpegTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return (
    String(hrs).padStart(2, "0") +
    ":" +
    String(mins).padStart(2, "0") +
    ":" +
    secs.toFixed(3).padStart(6, "0")
  );
}

function parseTimeFromLog(message) {
  const match = message.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return (
    parseInt(match[1], 10) * 3600 +
    parseInt(match[2], 10) * 60 +
    parseFloat(match[3])
  );
}

async function fetchWithProgress(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} khi tải ${url}`);
  }

  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body || !total) {
    return await response.arrayBuffer();
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(Math.min(100, Math.round((loaded / total) * 100)));
  }

  const result = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}

async function initFFmpeg() {
  if (ffmpeg) return;

  let lastError = null;

  for (let i = 0; i < CORE_CDNS.length; i++) {
    const baseUrl = CORE_CDNS[i];
    const coreUrl = `${baseUrl}/ffmpeg-core.js`;
    const wasmUrl = `${baseUrl}/ffmpeg-core.wasm`;

    try {
      self.postMessage({
        type: "loadProgress",
        percent: 5,
        text: `Đang tải lõi FFmpeg.wasm (máy chủ ${i + 1}/${CORE_CDNS.length})...`
      });

      const wasmBuffer = await fetchWithProgress(wasmUrl, (pct) => {
        self.postMessage({
          type: "loadProgress",
          percent: Math.max(5, Math.min(92, pct)),
          text: `Đang tải lõi FFmpeg.wasm (~31 MB)... ${pct}%`
        });
      });

      const wasmBlobUrl = URL.createObjectURL(
        new Blob([wasmBuffer], { type: "application/wasm" })
      );

      self.postMessage({
        type: "loadProgress",
        percent: 95,
        text: "Đang khởi tạo WebAssembly..."
      });

      if (typeof self.createFFmpegCore !== "function") {
        self.importScripts(coreUrl);
      }

      const configHash = btoa(JSON.stringify({ wasmURL: wasmBlobUrl, workerURL: "" }));

      ffmpeg = await self.createFFmpegCore({
        mainScriptUrlOrBlob: `${coreUrl}#${configHash}`,
        locateFile: (path) => (path.endsWith(".wasm") ? wasmBlobUrl : path)
      });

      ffmpeg.setLogger(({ message }) => {
        if (!message) return;
        logBuffer.push(message);
        if (logBuffer.length > 150) logBuffer.shift();

        self.postMessage({ type: "log", message });

        if (currentCutDuration > 0) {
          const parsedSec = parseTimeFromLog(message);
          if (parsedSec !== null) {
            lastEncodedTimeSec = parsedSec;
            const pct = Math.min(99, Math.max(0, Math.round((parsedSec / currentCutDuration) * 100)));
            self.postMessage({ type: "cutProgress", percent: pct, encodedTimeSec: parsedSec });
          }
        }
      });

      ffmpeg.setProgress(({ progress, time }) => {
        if (currentCutDuration <= 0) return;
        let pct = 0;
        if (typeof time === "number" && time > 0) {
          const sec = time / 1000000;
          lastEncodedTimeSec = sec;
          pct = Math.round((sec / currentCutDuration) * 100);
        } else if (typeof progress === "number" && progress >= 0 && progress <= 1) {
          pct = Math.round(progress * 100);
        }
        pct = Math.min(99, Math.max(0, pct));
        self.postMessage({ type: "cutProgress", percent: pct, encodedTimeSec: lastEncodedTimeSec });
      });

      self.postMessage({ type: "loadProgress", percent: 100, text: "FFmpeg.wasm đã sẵn sàng" });
      return;
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Không thể tải FFmpeg.wasm từ CDN. Kiểm tra kết nối mạng hoặc thử lại. Chi tiết: ${lastError?.message || lastError}`
  );
}

function cleanupInputMount() {
  if (!ffmpeg) return;
  try {
    if (isWorkerFSMounted) {
      ffmpeg.FS.unmount("/input");
      isWorkerFSMounted = false;
    } else if (mountedInputPath) {
      ffmpeg.FS.unlink(mountedInputPath);
    }
  } catch (_) {}
  mountedInputPath = null;
}

async function mountInputFile(file, ext) {
  await initFFmpeg();
  cleanupInputMount();

  const safeExt = (ext && /^\.[a-z0-9]{1,6}$/i.test(ext)) ? ext.toLowerCase() : ".mp4";
  const safeName = `source_video${safeExt}`;

  // Ưu tiên dùng WORKERFS để đọc trực tiếp từ đĩa, không nhân đôi RAM với video lớn
  try {
    if (ffmpeg.FS && ffmpeg.FS.filesystems && ffmpeg.FS.filesystems.WORKERFS) {
      try {
        ffmpeg.FS.mkdir("/input");
      } catch (_) {}

      ffmpeg.FS.mount(
        ffmpeg.FS.filesystems.WORKERFS,
        { blobs: [{ name: safeName, data: file }] },
        "/input"
      );

      isWorkerFSMounted = true;
      mountedInputPath = `/input/${safeName}`;
      return { method: "WORKERFS", inputPath: mountedInputPath };
    }
  } catch (err) {
    self.postMessage({
      type: "log",
      message: `[Info] WORKERFS không khả dụng, chuyển sang MEMFS: ${err.message}`
    });
  }

  // Fallback sang MEMFS nếu trình duyệt không hỗ trợ WORKERFS
  const buf = await file.arrayBuffer();
  mountedInputPath = `/${safeName}`;
  ffmpeg.FS.writeFile(mountedInputPath, new Uint8Array(buf));
  isWorkerFSMounted = false;
  return { method: "MEMFS", inputPath: mountedInputPath };
}

function execFFmpeg(args) {
  if (typeof ffmpeg.setTimeout === "function") {
    ffmpeg.setTimeout(-1);
  }
  const directRet = ffmpeg.exec(...args);
  const ret = typeof ffmpeg.ret === "number" ? ffmpeg.ret : (typeof directRet === "number" ? directRet : 0);
  if (typeof ffmpeg.reset === "function") {
    ffmpeg.reset();
  }
  return ret;
}

async function probeMountedVideo() {
  if (!mountedInputPath) {
    throw new Error("Chưa nạp file video nguồn.");
  }

  logBuffer = [];
  currentCutDuration = 0;
  execFFmpeg(["-i", mountedInputPath]);

  const joined = logBuffer.join("\n");
  let duration = 0;
  let resolution = "";

  const durMatch = joined.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (durMatch) {
    duration =
      parseInt(durMatch[1], 10) * 3600 +
      parseInt(durMatch[2], 10) * 60 +
      parseFloat(durMatch[3]);
  }

  const resMatch = joined.match(/Stream.*Video:.*?(\d{2,5})x(\d{2,5})/);
  if (resMatch) {
    resolution = `${resMatch[1]} × ${resMatch[2]}`;
  }

  return { duration, resolution };
}

async function cutSegment({ startSec, durationSec, isLastSegment, mode, crf, preset }) {
  if (!mountedInputPath) {
    throw new Error("Chưa nạp file video nguồn vào FFmpeg.");
  }

  const outputPath = "/output_segment.mp4";
  try {
    ffmpeg.FS.unlink(outputPath);
  } catch (_) {}

  logBuffer = [];
  currentCutDuration = Math.max(0.1, durationSec);
  lastEncodedTimeSec = 0;

  const args = ["-hide_banner", "-ss", formatFFmpegTime(startSec), "-i", mountedInputPath];

  // Với tập cuối cùng, bỏ -t để cắt trọn vẹn tới hết khung hình cuối cùng, không bỏ sót nội dung
  if (!isLastSegment) {
    args.push("-t", formatFFmpegTime(durationSec));
  }

  args.push("-map", "0:v:0", "-map", "0:a?");

  if (mode === "reencode") {
    args.push(
      "-c:v", "libx264",
      "-preset", preset || "veryfast",
      "-crf", String(crf || 18),
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k"
    );
  } else {
    args.push(
      "-c", "copy",
      "-avoid_negative_ts", "make_zero"
    );
  }

  args.push("-movflags", "+faststart", "-y", outputPath);

  const exitCode = execFFmpeg(args);

  if (exitCode !== 0) {
    const tail = logBuffer.slice(-8).join(" | ");
    if (mode === "copy") {
      throw new Error(
        `FFmpeg không thể đóng gói trực tiếp bằng Stream Copy (mã lỗi ${exitCode}). Video gốc có thể dùng codec không tương thích MP4 (như MKV/VP9/Opus). Hãy thử chuyển sang chế độ "Mã hóa lại chất lượng cao". Chi tiết: ${tail}`
      );
    }
    throw new Error(`FFmpeg báo lỗi khi xử lý (mã lỗi ${exitCode}). Chi tiết: ${tail}`);
  }

  let data;
  try {
    data = ffmpeg.FS.readFile(outputPath);
  } catch (err) {
    throw new Error("Không đọc được file MP4 sau khi cắt (có thể do thiếu bộ nhớ RAM).");
  }

  // Sao chép dữ liệu ra ArrayBuffer độc lập và giải phóng ngay bộ nhớ WASM FS
  const outputBuffer = data.slice().buffer;
  try {
    ffmpeg.FS.unlink(outputPath);
  } catch (_) {}

  currentCutDuration = 0;

  return {
    buffer: outputBuffer,
    size: outputBuffer.byteLength,
    encodedTimeSec: lastEncodedTimeSec
  };
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};
  try {
    if (type === "init") {
      await initFFmpeg();
      self.postMessage({ id, type: "result", ok: true });
    } else if (type === "mount") {
      const info = await mountInputFile(payload.file, payload.ext);
      self.postMessage({ id, type: "result", ok: true, data: info });
    } else if (type === "probe") {
      const info = await probeMountedVideo();
      self.postMessage({ id, type: "result", ok: true, data: info });
    } else if (type === "cut") {
      const res = await cutSegment(payload);
      self.postMessage(
        {
          id,
          type: "result",
          ok: true,
          data: {
            buffer: res.buffer,
            size: res.size,
            encodedTimeSec: res.encodedTimeSec
          }
        },
        [res.buffer]
      );
    } else if (type === "cleanup") {
      cleanupInputMount();
      self.postMessage({ id, type: "result", ok: true });
    }
  } catch (err) {
    currentCutDuration = 0;
    self.postMessage({
      id,
      type: "result",
      ok: false,
      error: err?.message || String(err)
    });
  }
};
