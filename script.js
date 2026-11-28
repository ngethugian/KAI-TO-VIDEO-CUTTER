/* KAI TỒ VIDEO CUTTER — Logic ứng dụng chính (hỗ trợ Logo mờ góc trên trái + cầu nối Facebook) */

(() => {
  "use strict";

  const STORAGE_LOGO_SETTINGS = "kaito_logo_settings_v1";
  const STORAGE_LOGO_DATAURL = "kaito_logo_dataurl_v1";

  const state = {
    sourceFile: null,
    sourceUrl: null,
    duration: 0,
    resolution: "",
    segments: [],
    isProcessing: false,
    isCancelling: false,
    worker: null,
    workerReady: false,
    workerMountedFile: null,
    requestSeq: 0,
    pendingRequests: new Map(),
    modalSegmentId: null,
    logo: {
      enabled: false,
      dataUrl: "",
      name: "",
      opacity: 45,
      sizePct: 14,
      marginPct: 2.5
    }
  };

  const el = {
    ffmpegStatusBadge: document.getElementById("ffmpegStatusBadge"),
    ffmpegStatusText: document.getElementById("ffmpegStatusText"),
    alertBanner: document.getElementById("alertBanner"),

    dropZone: document.getElementById("dropZone"),
    videoInput: document.getElementById("videoInput"),
    selectFileBtn: document.getElementById("selectFileBtn"),

    videoInfoSection: document.getElementById("videoInfoSection"),
    sourceVideoPlayer: document.getElementById("sourceVideoPlayer"),
    logoOverlayPreview: document.getElementById("logoOverlayPreview"),
    previewFallbackNote: document.getElementById("previewFallbackNote"),
    fileNameDisplay: document.getElementById("fileNameDisplay"),
    fileSizeDisplay: document.getElementById("fileSizeDisplay"),
    fileDurationDisplay: document.getElementById("fileDurationDisplay"),
    fileResolutionDisplay: document.getElementById("fileResolutionDisplay"),
    changeVideoBtn: document.getElementById("changeVideoBtn"),
    clearMemoryBtn: document.getElementById("clearMemoryBtn"),

    chunkMinutesInput: document.getElementById("chunkMinutesInput"),
    chunkSecondsInput: document.getElementById("chunkSecondsInput"),
    presetBtns: document.querySelectorAll(".preset-btn"),

    modeCopy: document.getElementById("modeCopy"),
    modeReencode: document.getElementById("modeReencode"),
    keyframeNotice: document.getElementById("keyframeNotice"),
    reencodeOptions: document.getElementById("reencodeOptions"),
    crfSelect: document.getElementById("crfSelect"),
    presetSelect: document.getElementById("presetSelect"),

    // Điều khiển Logo mờ góc trên trái
    enableLogoCheckbox: document.getElementById("enableLogoCheckbox"),
    logoSettingsBox: document.getElementById("logoSettingsBox"),
    logoFileInput: document.getElementById("logoFileInput"),
    selectLogoBtn: document.getElementById("selectLogoBtn"),
    removeLogoBtn: document.getElementById("removeLogoBtn"),
    logoThumbPreview: document.getElementById("logoThumbPreview"),
    logoThumbPlaceholder: document.getElementById("logoThumbPlaceholder"),
    logoOpacityInput: document.getElementById("logoOpacityInput"),
    logoOpacityValue: document.getElementById("logoOpacityValue"),
    logoSizeInput: document.getElementById("logoSizeInput"),
    logoSizeValue: document.getElementById("logoSizeValue"),
    logoMarginInput: document.getElementById("logoMarginInput"),
    logoMarginValue: document.getElementById("logoMarginValue"),

    videoTitleInput: document.getElementById("videoTitleInput"),
    channelNameInput: document.getElementById("channelNameInput"),
    includeChannelCheckbox: document.getElementById("includeChannelCheckbox"),
    episodePrefixInput: document.getElementById("episodePrefixInput"),
    startEpisodeInput: document.getElementById("startEpisodeInput"),
    fileNameSample: document.getElementById("fileNameSample"),
    totalEpisodesCount: document.getElementById("totalEpisodesCount"),
    resetNamesBtn: document.getElementById("resetNamesBtn"),

    startCutBtn: document.getElementById("startCutBtn"),
    cancelCutBtn: document.getElementById("cancelCutBtn"),
    downloadAllZipBtn: document.getElementById("downloadAllZipBtn"),
    ramUsageDisplay: document.getElementById("ramUsageDisplay"),

    progressSection: document.getElementById("progressSection"),
    progressStatusText: document.getElementById("progressStatusText"),
    progressPercentText: document.getElementById("progressPercentText"),
    overallProgressBar: document.getElementById("overallProgressBar"),
    currentEpText: document.getElementById("currentEpText"),
    currentEpPercentText: document.getElementById("currentEpPercentText"),
    currentEpProgressBar: document.getElementById("currentEpProgressBar"),
    toggleLogBtn: document.getElementById("toggleLogBtn"),
    logContainer: document.getElementById("logContainer"),
    ffmpegLogOutput: document.getElementById("ffmpegLogOutput"),

    episodeListContainer: document.getElementById("episodeListContainer"),

    previewModal: document.getElementById("previewModal"),
    modalBackdrop: document.getElementById("modalBackdrop"),
    modalTitle: document.getElementById("modalTitle"),
    modalMeta: document.getElementById("modalMeta"),
    modalVideoPlayer: document.getElementById("modalVideoPlayer"),
    modalDownloadBtn: document.getElementById("modalDownloadBtn"),
    closeModalBtn: document.getElementById("closeModalBtn"),

    toastContainer: document.getElementById("toastContainer")
  };

  /* ===================== TIỆN ÍCH ĐỊNH DẠNG ===================== */

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
    const units = ["B", "KB", "MB", "GB"];
    let idx = 0;
    let val = bytes;
    while (val >= 1024 && idx < units.length - 1) {
      val /= 1024;
      idx++;
    }
    return `${val.toFixed(idx >= 2 ? 2 : 1)} ${units[idx]}`;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
    const total = Math.round(seconds);
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function sanitizeFilename(name) {
    return (name || "VIDEO")
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\.mp4$/i, "");
  }

  function stripExtension(filename) {
    return (filename || "").replace(/\.[^/.]+$/, "");
  }

  function getFileExtension(filename) {
    const match = (filename || "").match(/(\.[a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : ".mp4";
  }

  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    el.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 4500);
  }

  function showAlert(message, type = "warning") {
    if (!message) {
      el.alertBanner.classList.add("hidden");
      el.alertBanner.textContent = "";
      return;
    }
    el.alertBanner.className = `alert-banner alert-${type}`;
    el.alertBanner.textContent = message;
    el.alertBanner.classList.remove("hidden");
  }

  function setFFmpegBadge(status, text) {
    el.ffmpegStatusBadge.className = `status-pill status-${status}`;
    el.ffmpegStatusText.textContent = text;
  }

  function appendLog(line) {
    const lines = el.ffmpegLogOutput.textContent.split("\n");
    if (lines.length > 220) {
      lines.splice(0, lines.length - 220);
    }
    lines.push(line);
    el.ffmpegLogOutput.textContent = lines.join("\n").trim();
    el.logContainer.scrollTop = el.logContainer.scrollHeight;
  }

  function notifySegmentsUpdated() {
    window.dispatchEvent(new CustomEvent("kaito:segments-updated"));
  }

  /* ===================== QUẢN LÝ LOGO MỜ (WATERMARK) ===================== */

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Không đọc được file ảnh logo."));
      img.src = src;
    });
  }

  function getVideoDimensions() {
    if (el.sourceVideoPlayer && el.sourceVideoPlayer.videoWidth && el.sourceVideoPlayer.videoHeight) {
      return {
        width: el.sourceVideoPlayer.videoWidth,
        height: el.sourceVideoPlayer.videoHeight
      };
    }
    const match = (state.resolution || "").match(/(\d+)\s*[×x]\s*(\d+)/i);
    if (match) {
      return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
    }
    return { width: 1280, height: 720 };
  }

  function saveLogoPrefs() {
    try {
      localStorage.setItem(
        STORAGE_LOGO_SETTINGS,
        JSON.stringify({
          enabled: state.logo.enabled,
          name: state.logo.name,
          opacity: state.logo.opacity,
          sizePct: state.logo.sizePct,
          marginPct: state.logo.marginPct
        })
      );
      if (state.logo.dataUrl && state.logo.dataUrl.length < 1800000) {
        localStorage.setItem(STORAGE_LOGO_DATAURL, state.logo.dataUrl);
      } else if (!state.logo.dataUrl) {
        localStorage.removeItem(STORAGE_LOGO_DATAURL);
      }
    } catch (_) {}
  }

  function restoreLogoPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_LOGO_SETTINGS);
      if (raw) {
        const parsed = JSON.parse(raw);
        state.logo.enabled = Boolean(parsed.enabled);
        state.logo.name = parsed.name || "";
        state.logo.opacity = Math.max(10, Math.min(100, Number(parsed.opacity) || 45));
        state.logo.sizePct = Math.max(5, Math.min(35, Number(parsed.sizePct) || 14));
        state.logo.marginPct = Math.max(0, Math.min(10, Number(parsed.marginPct ?? 2.5)));
      }
      const savedUrl = localStorage.getItem(STORAGE_LOGO_DATAURL);
      if (savedUrl) {
        state.logo.dataUrl = savedUrl;
      }
    } catch (_) {}
  }

  function updateModeVisibility() {
    const needReencode = el.modeReencode.checked || (el.enableLogoCheckbox && el.enableLogoCheckbox.checked);
    el.reencodeOptions.classList.toggle("hidden", !needReencode);
    el.keyframeNotice.classList.toggle("hidden", needReencode);
  }

  function updateLogoUI() {
    if (!el.enableLogoCheckbox) return;

    el.enableLogoCheckbox.checked = state.logo.enabled;
    el.logoSettingsBox.classList.toggle("hidden", !state.logo.enabled);

    el.logoOpacityInput.value = String(state.logo.opacity);
    el.logoOpacityValue.textContent = `${state.logo.opacity}%`;
    el.logoSizeInput.value = String(state.logo.sizePct);
    el.logoSizeValue.textContent = `${state.logo.sizePct}%`;
    el.logoMarginInput.value = String(state.logo.marginPct);
    el.logoMarginValue.textContent = `${state.logo.marginPct}%`;

    if (state.logo.dataUrl) {
      el.logoThumbPreview.src = state.logo.dataUrl;
      el.logoThumbPreview.classList.remove("hidden");
      el.logoThumbPlaceholder.classList.add("hidden");
      el.removeLogoBtn.classList.remove("hidden");
    } else {
      el.logoThumbPreview.removeAttribute("src");
      el.logoThumbPreview.classList.add("hidden");
      el.logoThumbPlaceholder.classList.remove("hidden");
      el.removeLogoBtn.classList.add("hidden");
    }

    updateLogoPreviewOnVideo();
    updateModeVisibility();
  }

  function updateLogoPreviewOnVideo() {
    if (!el.logoOverlayPreview) return;

    if (!state.logo.enabled || !state.logo.dataUrl || !state.sourceFile) {
      el.logoOverlayPreview.classList.add("hidden");
      return;
    }

    const { width: videoW, height: videoH } = getVideoDimensions();
    const aspect = videoW > 0 && videoH > 0 ? videoW / videoH : 16 / 9;
    const topPct = state.logo.marginPct * aspect;

    el.logoOverlayPreview.src = state.logo.dataUrl;
    el.logoOverlayPreview.style.opacity = String(state.logo.opacity / 100);
    el.logoOverlayPreview.style.width = `${state.logo.sizePct}%`;
    el.logoOverlayPreview.style.left = `${state.logo.marginPct}%`;
    el.logoOverlayPreview.style.top = `${topPct.toFixed(2)}%`;
    el.logoOverlayPreview.classList.remove("hidden");
  }

  function handleLogoFileSelected(file) {
    if (!file || !file.type.startsWith("image/")) {
      showToast("Vui lòng chọn đúng file ảnh logo (ưu tiên PNG nền trong suốt).", "error");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const rawUrl = String(reader.result || "");
        const img = await loadImage(rawUrl);

        // Giữ nguyên nền trong suốt PNG, giới hạn cạnh tối đa 1024px cho gọn bộ nhớ
        const maxSide = 1024;
        let w = img.naturalWidth || 400;
        let h = img.naturalHeight || 400;
        if (w > maxSide || h > maxSide) {
          const ratio = Math.min(maxSide / w, maxSide / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        state.logo.dataUrl = canvas.toDataURL("image/png");
        state.logo.name = file.name;
        state.logo.enabled = true;
        saveLogoPrefs();
        updateLogoUI();
        showToast("Đã thêm logo mờ vào góc trên bên trái!", "success");
      } catch (err) {
        showToast(err.message || "Không thể đọc ảnh logo.", "error");
      }
    };
    reader.readAsDataURL(file);
  }

  // Tạo file PNG đúng kích thước & độ mờ theo video thực tế để nạp vào FFmpeg
  async function buildLogoPayloadForFFmpeg() {
    if (!state.logo.enabled || !state.logo.dataUrl) return null;

    const { width: videoW, height: videoH } = getVideoDimensions();
    const img = await loadImage(state.logo.dataUrl);

    let finalW = Math.max(16, Math.round(videoW * (state.logo.sizePct / 100)));
    const imgRatio = (img.naturalHeight || 1) / (img.naturalWidth || 1);
    let finalH = Math.max(16, Math.round(finalW * imgRatio));

    const maxH = Math.round(videoH * 0.55);
    if (finalH > maxH) {
      const scale = maxH / finalH;
      finalW = Math.max(16, Math.round(finalW * scale));
      finalH = Math.max(16, Math.round(finalH * scale));
    }

    const canvas = document.createElement("canvas");
    canvas.width = finalW;
    canvas.height = finalH;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, finalW, finalH);
    ctx.globalAlpha = Math.max(0.05, Math.min(1, state.logo.opacity / 100));
    ctx.drawImage(img, 0, 0, finalW, finalH);

    const pngBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Không thể tạo ảnh logo PNG cho FFmpeg."))),
        "image/png"
      );
    });

    const buffer = await pngBlob.arrayBuffer();
    const marginPx = Math.max(0, Math.round(videoW * (state.logo.marginPct / 100)));

    return {
      buffer,
      marginX: marginPx,
      marginY: marginPx
    };
  }

  /* ===================== QUẢN LÝ WEB WORKER FFMPEG ===================== */

  function ensureWorker() {
    if (state.worker) return state.worker;

    const worker = new Worker("./ffmpeg-worker.js");
    state.worker = worker;

    worker.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === "loadProgress") {
        setFFmpegBadge(msg.percent >= 100 ? "ready" : "loading", msg.text);
        if (state.isProcessing) {
          el.progressStatusText.textContent = msg.text;
        }
        return;
      }

      if (msg.type === "log") {
        appendLog(msg.message);
        return;
      }

      if (msg.type === "cutProgress") {
        el.currentEpPercentText.textContent = `${msg.percent}%`;
        el.currentEpProgressBar.style.width = `${msg.percent}%`;
        return;
      }

      if (msg.type === "result") {
        const pending = state.pendingRequests.get(msg.id);
        if (!pending) return;
        state.pendingRequests.delete(msg.id);
        if (msg.ok) {
          pending.resolve(msg.data);
        } else {
          pending.reject(new Error(msg.error || "Lỗi xử lý không xác định."));
        }
      }
    };

    worker.onerror = (err) => {
      const msg = err?.message || "Web Worker gặp sự cố (có thể do hết bộ nhớ RAM).";
      setFFmpegBadge("error", "Lỗi FFmpeg Worker");
      rejectAllPending(new Error(msg));
      terminateWorker();
    };

    return worker;
  }

  function rejectAllPending(error) {
    for (const [, pending] of state.pendingRequests) {
      pending.reject(error);
    }
    state.pendingRequests.clear();
  }

  function terminateWorker() {
    if (state.worker) {
      state.worker.terminate();
      state.worker = null;
    }
    state.workerReady = false;
    state.workerMountedFile = null;
  }

  function callWorker(type, payload = {}, transferables = []) {
    return new Promise((resolve, reject) => {
      const worker = ensureWorker();
      const id = ++state.requestSeq;
      state.pendingRequests.set(id, { resolve, reject });
      worker.postMessage({ id, type, payload }, transferables);
    });
  }

  /* ===================== TÍNH TOÁN TẬP & TÊN FILE ===================== */

  function getChunkDurationSeconds() {
    const mins = Math.max(0, parseInt(el.chunkMinutesInput.value, 10) || 0);
    const secs = Math.max(0, Math.min(59, parseInt(el.chunkSecondsInput.value, 10) || 0));
    const total = mins * 60 + secs;
    return total > 0 ? total : 60;
  }

  function buildEpisodeName(episodeNumber) {
    const rawTitle = sanitizeFilename(el.videoTitleInput.value) || sanitizeFilename(stripExtension(state.sourceFile?.name)) || "VIDEO";
    const channel = sanitizeFilename(el.channelNameInput.value);
    const prefix = sanitizeFilename(el.episodePrefixInput.value) || "TẬP";
    const padded = String(episodeNumber).padStart(2, "0");

    let base = `${rawTitle} - ${prefix} ${padded}`;
    if (el.includeChannelCheckbox.checked && channel) {
      base = `[${channel}] ${base}`;
    }
    return sanitizeFilename(base);
  }

  function updateNamingSample() {
    const startEp = Math.max(0, parseInt(el.startEpisodeInput.value, 10) || 1);
    el.fileNameSample.textContent = `${buildEpisodeName(startEp)}.mp4`;
  }

  function revokeSegmentBlobs() {
    for (const seg of state.segments) {
      if (seg.blobUrl) {
        URL.revokeObjectURL(seg.blobUrl);
        seg.blobUrl = null;
      }
      seg.blob = null;
      seg.outputSize = 0;
    }
    updateRamDisplay();
  }

  function recalculateSegments(forceResetNames = false) {
    updateNamingSample();

    if (!state.sourceFile || state.duration <= 0) {
      revokeSegmentBlobs();
      state.segments = [];
      el.totalEpisodesCount.textContent = "0 tập";
      renderEpisodeList();
      updateActionButtons();
      notifySegmentsUpdated();
      return;
    }

    const chunkSec = getChunkDurationSeconds();
    const startEp = Math.max(0, parseInt(el.startEpisodeInput.value, 10) || 1);
    const oldCustomNames = new Map();
    if (!forceResetNames) {
      for (const seg of state.segments) {
        if (seg.customEdited) {
          oldCustomNames.set(seg.index, seg.title);
        }
      }
    }

    revokeSegmentBlobs();

    const segments = [];
    let cursor = 0;
    let idx = 0;

    while (cursor < state.duration) {
      const remaining = state.duration - cursor;
      if (remaining < 0.15 && segments.length > 0) {
        segments[segments.length - 1].endSec = state.duration;
        segments[segments.length - 1].expectedDuration = state.duration - segments[segments.length - 1].startSec;
        break;
      }

      const endSec = Math.min(state.duration, cursor + chunkSec);
      const epNumber = startEp + idx;
      const autoName = buildEpisodeName(epNumber);
      const hasCustom = oldCustomNames.has(idx);

      segments.push({
        id: `ep_${idx}_${Date.now()}`,
        index: idx,
        epNumber,
        title: hasCustom ? oldCustomNames.get(idx) : autoName,
        customEdited: hasCustom,
        startSec: cursor,
        endSec,
        expectedDuration: endSec - cursor,
        actualDuration: null,
        keyframeDriftSec: 0,
        status: "idle",
        errorMessage: "",
        blob: null,
        blobUrl: null,
        outputSize: 0
      });

      cursor = endSec;
      idx++;
    }

    state.segments = segments;
    el.totalEpisodesCount.textContent = `${segments.length} tập`;
    renderEpisodeList();
    updateActionButtons();
    notifySegmentsUpdated();
  }

  function updateEpisodeNamesOnly(forceReset = false) {
    updateNamingSample();
    const startEp = Math.max(0, parseInt(el.startEpisodeInput.value, 10) || 1);
    state.segments.forEach((seg, idx) => {
      seg.epNumber = startEp + idx;
      if (forceReset || !seg.customEdited) {
        seg.title = buildEpisodeName(seg.epNumber);
        seg.customEdited = false;
      }
    });
    renderEpisodeList();
    notifySegmentsUpdated();
  }

  function updateRamDisplay() {
    const totalBytes = state.segments.reduce((sum, seg) => sum + (seg.outputSize || 0), 0);
    el.ramUsageDisplay.textContent = `Bộ nhớ xuất: ${formatBytes(totalBytes)}`;
  }

  function updateActionButtons() {
    const hasSegments = state.segments.length > 0;
    const completedCount = state.segments.filter((s) => s.status === "done" && s.blob).length;

    el.startCutBtn.disabled = state.isProcessing || !hasSegments;
    el.downloadAllZipBtn.disabled = state.isProcessing || completedCount === 0;
    el.cancelCutBtn.classList.toggle("hidden", !state.isProcessing);

    if (completedCount > 0) {
      el.downloadAllZipBtn.textContent = `Tải toàn bộ ${completedCount} tập (.ZIP)`;
    } else {
      el.downloadAllZipBtn.textContent = "Tải toàn bộ (.ZIP)";
    }
  }

  /* ===================== HIỂN THỊ DANH SÁCH TẬP ===================== */

  function getStatusBadgeHtml(seg) {
    if (seg.status === "processing") {
      return `<span class="badge badge-processing">Đang xử lý...</span>`;
    }
    if (seg.status === "done") {
      if (Math.abs(seg.keyframeDriftSec) >= 1.5) {
        const sign = seg.keyframeDriftSec > 0 ? "+" : "";
        return `<span class="badge badge-success">Hoàn thành</span> <span class="badge badge-warn" title="Do chế độ Stream Copy cắt tại keyframe gần nhất">Lệch keyframe (${sign}${seg.keyframeDriftSec.toFixed(1)}s)</span>`;
      }
      return `<span class="badge badge-success">Hoàn thành</span>`;
    }
    if (seg.status === "error") {
      return `<span class="badge badge-error" title="${escapeHtmlAttr(seg.errorMessage)}">Lỗi</span>`;
    }
    return `<span class="badge badge-idle">Chờ xử lý</span>`;
  }

  function renderEpisodeList() {
    if (state.segments.length === 0) {
      el.episodeListContainer.innerHTML = `
        <div class="empty-state">
          Hãy chọn một video ở Bước 1 để hệ thống tự động tính toán và liệt kê các tập.
        </div>`;
      return;
    }

    const fragment = document.createDocumentFragment();

    state.segments.forEach((seg, i) => {
      const card = document.createElement("div");
      card.className = "episode-card";
      if (seg.status === "processing") card.classList.add("ep-active");
      if (seg.status === "done") card.classList.add("ep-done");

      const actualText = seg.actualDuration
        ? ` • Thực tế: <strong>${formatDuration(seg.actualDuration)}</strong>`
        : "";
      const sizeText = seg.outputSize > 0 ? ` • ${formatBytes(seg.outputSize)}` : "";
      const isLast = i === state.segments.length - 1;

      card.innerHTML = `
        <div class="ep-index">${String(seg.epNumber).padStart(2, "0")}</div>

        <div class="ep-name-col">
          <input
            type="text"
            class="ep-name-input"
            data-seg-id="${seg.id}"
            value="${escapeHtmlAttr(seg.title)}"
            aria-label="Tên file tập ${seg.epNumber}"
            ${state.isProcessing ? "disabled" : ""}
          />
          <div class="ep-subline">
            <span>Khung giờ: <strong>${formatDuration(seg.startSec)} – ${formatDuration(seg.endSec)}</strong>${isLast ? " (hết video)" : ""}</span>
            ${getStatusBadgeHtml(seg)}
          </div>
          ${seg.errorMessage ? `<div class="ep-subline" style="color:#f87171">${escapeHtml(seg.errorMessage)}</div>` : ""}
        </div>

        <div class="ep-meta-col">
          <div>Dự kiến: <strong>${formatDuration(seg.expectedDuration)}</strong>${actualText}</div>
          <div>File xuất: <code>.mp4</code>${sizeText}</div>
        </div>

        <div class="ep-actions-col">
          <button
            type="button"
            class="btn btn-secondary btn-sm btn-preview-ep"
            data-seg-id="${seg.id}"
            ${seg.blobUrl ? "" : "disabled"}
          >Xem trước</button>
          <button
            type="button"
            class="btn btn-primary btn-sm btn-download-ep"
            data-seg-id="${seg.id}"
            ${seg.blob ? "" : "disabled"}
          >Tải về</button>
        </div>
      `;

      fragment.appendChild(card);
    });

    el.episodeListContainer.innerHTML = "";
    el.episodeListContainer.appendChild(fragment);
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeHtmlAttr(str) {
    return escapeHtml(str).replace(/"/g, "&quot;");
  }

  /* ===================== ĐỌC METADATA VIDEO ===================== */

  function readBrowserVideoMetadata(url) {
    return new Promise((resolve, reject) => {
      const tempVideo = document.createElement("video");
      tempVideo.preload = "metadata";
      tempVideo.muted = true;
      tempVideo.src = url;

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Quá thời gian đọc metadata trình duyệt."));
      }, 8000);

      function cleanup() {
        clearTimeout(timer);
        tempVideo.onloadedmetadata = null;
        tempVideo.onerror = null;
      }

      tempVideo.onloadedmetadata = () => {
        const duration = tempVideo.duration;
        const width = tempVideo.videoWidth;
        const height = tempVideo.videoHeight;
        cleanup();
        if (Number.isFinite(duration) && duration > 0) {
          resolve({
            duration,
            resolution: width && height ? `${width} × ${height}` : ""
          });
        } else {
          reject(new Error("Không đọc được thời lượng video."));
        }
      };

      tempVideo.onerror = () => {
        cleanup();
        reject(new Error("Trình duyệt không giải mã được định dạng này."));
      };
    });
  }

  async function handleFileSelected(file) {
    if (!file) return;
    if (state.isProcessing) {
      showToast("Vui lòng hủy hoặc chờ quá trình cắt hiện tại hoàn tất.", "warn");
      return;
    }

    showAlert("");
    revokeSegmentBlobs();
    if (state.sourceUrl) {
      URL.revokeObjectURL(state.sourceUrl);
      state.sourceUrl = null;
    }

    state.sourceFile = file;
    state.workerMountedFile = null;
    state.duration = 0;
    state.resolution = "";
    state.sourceUrl = URL.createObjectURL(file);

    el.dropZone.classList.add("hidden");
    el.videoInfoSection.classList.remove("hidden");
    el.previewFallbackNote.classList.add("hidden");

    el.fileNameDisplay.textContent = file.name;
    el.fileNameDisplay.title = file.name;
    el.fileSizeDisplay.textContent = formatBytes(file.size);
    el.fileDurationDisplay.textContent = "Đang đọc thời lượng...";
    el.fileResolutionDisplay.textContent = "Đang kiểm tra...";

    if (!el.videoTitleInput.value.trim()) {
      el.videoTitleInput.value = sanitizeFilename(stripExtension(file.name)).toUpperCase();
    }

    el.sourceVideoPlayer.src = state.sourceUrl;

    if (file.size > 1.8 * 1024 * 1024 * 1024) {
      showAlert(
        "Video có dung lượng lớn (trên 1.8 GB). Hệ thống dùng WORKERFS để giảm tối đa RAM, hãy đóng bớt tab khác để xử lý ổn định nhất.",
        "warning"
      );
    }

    try {
      const meta = await readBrowserVideoMetadata(state.sourceUrl);
      state.duration = meta.duration;
      state.resolution = meta.resolution || "Không xác định";
      el.fileDurationDisplay.textContent = formatDuration(state.duration);
      el.fileResolutionDisplay.textContent = state.resolution;
      updateLogoPreviewOnVideo();
      recalculateSegments(true);
      showToast(`Đã nạp video (${formatDuration(state.duration)}) — dự kiến ${state.segments.length} tập.`, "success");
    } catch (_) {
      el.previewFallbackNote.classList.remove("hidden");
      el.fileDurationDisplay.textContent = "Đang phân tích bằng FFmpeg.wasm...";
      setFFmpegBadge("loading", "Đang nạp FFmpeg để đọc video...");

      try {
        await callWorker("mount", { file, ext: getFileExtension(file.name) });
        state.workerReady = true;
        state.workerMountedFile = file;
        const probe = await callWorker("probe");

        if (!probe.duration || probe.duration <= 0) {
          throw new Error("Không thể đọc thời lượng từ file này. Hãy kiểm tra lại định dạng video.");
        }

        state.duration = probe.duration;
        state.resolution = probe.resolution || "Không xác định";
        el.fileDurationDisplay.textContent = formatDuration(state.duration);
        el.fileResolutionDisplay.textContent = state.resolution;
        setFFmpegBadge("ready", "FFmpeg.wasm đã sẵn sàng");
        updateLogoPreviewOnVideo();
        recalculateSegments(true);
        showToast(`FFmpeg đã đọc xong video (${formatDuration(state.duration)}).`, "success");
      } catch (err) {
        el.fileDurationDisplay.textContent = "Lỗi đọc thời lượng";
        el.fileResolutionDisplay.textContent = "—";
        showAlert(`Không thể đọc video: ${err.message}`, "error");
      }
    }
  }

  /* ===================== CHIA VIDEO THỰC TẾ ===================== */

  async function startCutting() {
    if (!state.sourceFile || state.segments.length === 0 || state.isProcessing) return;

    if (state.logo.enabled && !state.logo.dataUrl) {
      showToast("Bạn đang bật chèn logo nhưng chưa chọn ảnh logo. Hãy chọn ảnh hoặc bỏ tích chèn logo.", "warn");
      return;
    }

    const useLogo = Boolean(state.logo.enabled && state.logo.dataUrl);
    const cutMode = useLogo || el.modeReencode.checked ? "reencode" : "copy";
    const crf = el.crfSelect.value;
    const preset = el.presetSelect.value;

    state.isProcessing = true;
    state.isCancelling = false;
    showAlert("");
    revokeSegmentBlobs();

    state.segments.forEach((seg) => {
      seg.status = "idle";
      seg.errorMessage = "";
      seg.actualDuration = null;
      seg.keyframeDriftSec = 0;
    });

    el.ffmpegLogOutput.textContent = "";
    el.progressSection.classList.remove("hidden");
    el.overallProgressBar.style.width = "0%";
    el.progressPercentText.textContent = "0%";
    el.currentEpProgressBar.style.width = "0%";
    el.currentEpPercentText.textContent = "0%";
    el.progressStatusText.textContent = "Đang khởi tạo FFmpeg.wasm...";
    el.currentEpText.textContent = "Đang nạp video nguồn vào bộ xử lý...";

    renderEpisodeList();
    updateActionButtons();
    notifySegmentsUpdated();

    let keyframeDriftCount = 0;
    let successCount = 0;

    try {
      if (state.workerMountedFile !== state.sourceFile) {
        setFFmpegBadge("loading", "Đang nạp lõi & liên kết video...");
        const mountRes = await callWorker("mount", {
          file: state.sourceFile,
          ext: getFileExtension(state.sourceFile.name)
        });
        state.workerReady = true;
        state.workerMountedFile = state.sourceFile;
        setFFmpegBadge("ready", `FFmpeg sẵn sàng (${mountRes.method})`);
      }

      // Nạp hoặc gỡ file logo mờ trên FFmpeg trước khi chạy vòng lặp cắt
      let logoConfig = null;
      if (useLogo) {
        el.currentEpText.textContent = "Đang chuẩn bị ảnh logo mờ cho FFmpeg...";
        const renderedLogo = await buildLogoPayloadForFFmpeg();
        await callWorker("setLogo", { buffer: renderedLogo.buffer }, [renderedLogo.buffer]);
        logoConfig = {
          enabled: true,
          marginX: renderedLogo.marginX,
          marginY: renderedLogo.marginY
        };
      } else {
        await callWorker("setLogo", { buffer: null });
      }

      const total = state.segments.length;

      for (let i = 0; i < total; i++) {
        if (state.isCancelling) break;

        const seg = state.segments[i];
        seg.status = "processing";
        renderEpisodeList();

        el.progressStatusText.textContent = useLogo
          ? `Đang cắt & gắn logo mờ tập ${i + 1}/${total}...`
          : `Đang xử lý tập ${i + 1}/${total}...`;
        el.currentEpText.textContent = `Đang xuất: ${seg.title}.mp4 (${formatDuration(seg.startSec)} – ${formatDuration(seg.endSec)})`;
        el.currentEpPercentText.textContent = "0%";
        el.currentEpProgressBar.style.width = "0%";

        try {
          const isLastSegment = i === total - 1;
          const result = await callWorker("cut", {
            startSec: seg.startSec,
            durationSec: seg.expectedDuration,
            isLastSegment,
            mode: cutMode,
            crf,
            preset,
            logo: logoConfig
          });

          if (state.isCancelling) break;

          const blob = new Blob([result.buffer], { type: "video/mp4" });
          const blobUrl = URL.createObjectURL(blob);

          seg.blob = blob;
          seg.blobUrl = blobUrl;
          seg.outputSize = result.size;
          seg.status = "done";

          try {
            const cutMeta = await readBrowserVideoMetadata(blobUrl);
            seg.actualDuration = cutMeta.duration;
          } catch (_) {
            seg.actualDuration = result.encodedTimeSec > 0 ? result.encodedTimeSec : seg.expectedDuration;
          }

          if (cutMode === "copy" && seg.actualDuration) {
            seg.keyframeDriftSec = seg.actualDuration - seg.expectedDuration;
            if (Math.abs(seg.keyframeDriftSec) >= 1.5) {
              keyframeDriftCount++;
            }
          }

          successCount++;
          updateRamDisplay();
          notifySegmentsUpdated();
        } catch (segErr) {
          if (state.isCancelling) break;
          seg.status = "error";
          seg.errorMessage = segErr.message;
        }

        const overallPct = Math.round(((i + 1) / total) * 100);
        el.overallProgressBar.style.width = `${overallPct}%`;
        el.progressPercentText.textContent = `${overallPct}%`;
        el.currentEpPercentText.textContent = "100%";
        el.currentEpProgressBar.style.width = "100%";
        renderEpisodeList();
      }

      if (state.isCancelling) {
        el.progressStatusText.textContent = "Đã hủy quá trình xử lý.";
        showToast("Đã hủy cắt video và giải phóng Worker.", "warn");
      } else if (successCount === state.segments.length) {
        el.progressStatusText.textContent = `Hoàn thành toàn bộ ${successCount}/${state.segments.length} tập!`;
        el.currentEpText.textContent = "Sẵn sàng xem trước, tải MP4/ZIP hoặc đăng lên Facebook.";
        showToast(`Đã cắt xong toàn bộ ${successCount} tập!`, "success");

        if (keyframeDriftCount > 0) {
          showAlert(
            `Có ${keyframeDriftCount} tập bị lệch điểm cắt nhẹ do chế độ Stream Copy (-c copy) chỉ cắt tại keyframe gần nhất để giữ 100% chất lượng gốc. Nếu cần cắt đúng từng giây, hãy chuyển sang chế độ "Mã hóa lại chất lượng cao".`,
            "warning"
          );
        } else {
          showAlert(
            useLogo
              ? `Hoàn tất xuất ${successCount} tập MP4 đã gắn logo mờ góc trên trái!`
              : `Hoàn tất xuất ${successCount} tập MP4 thành công!`,
            "success"
          );
        }
      } else {
        el.progressStatusText.textContent = `Hoàn tất với ${successCount}/${state.segments.length} tập thành công.`;
        showAlert(
          `Một số tập gặp lỗi khi xử lý (${state.segments.length - successCount} tập lỗi). Xem chi tiết ngay bên dưới từng tập hoặc mở nhật ký FFmpeg.`,
          "error"
        );
      }
    } catch (err) {
      if (!state.isCancelling) {
        el.progressStatusText.textContent = "Quá trình xử lý bị dừng do lỗi.";
        showAlert(`Lỗi hệ thống: ${err.message}`, "error");
        showToast("Đã xảy ra lỗi khi xử lý video.", "error");
      }
    } finally {
      state.isProcessing = false;
      state.isCancelling = false;
      renderEpisodeList();
      updateActionButtons();
      notifySegmentsUpdated();
    }
  }

  function cancelCutting() {
    if (!state.isProcessing) return;
    state.isCancelling = true;
    rejectAllPending(new Error("Người dùng đã hủy quá trình."));
    terminateWorker();
    setFFmpegBadge("idle", "Đã dừng FFmpeg Worker");

    state.segments.forEach((seg) => {
      if (seg.status === "processing") {
        seg.status = "idle";
      }
    });

    state.isProcessing = false;
    el.progressStatusText.textContent = "Đã hủy quá trình và thu hồi bộ nhớ.";
    el.currentEpText.textContent = "—";
    renderEpisodeList();
    updateActionButtons();
    notifySegmentsUpdated();
    showToast("Đã hủy cắt video ngay lập tức.", "warn");
  }

  /* ===================== TẢI FILE & ĐÓNG GÓI ZIP ===================== */

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function downloadSingleEpisode(segId) {
    const seg = state.segments.find((s) => s.id === segId);
    if (!seg || !seg.blob) return;
    const filename = `${sanitizeFilename(seg.title)}.mp4`;
    triggerDownload(seg.blob, filename);
    showToast(`Đang tải xuống: ${filename}`, "success");
  }

  async function downloadAllAsZip() {
    const readySegments = state.segments.filter((s) => s.status === "done" && s.blob);
    if (readySegments.length === 0) return;

    if (typeof window.JSZip === "undefined") {
      showAlert("Không tải được thư viện JSZip. Kiểm tra kết nối Internet và tải lại trang.", "error");
      return;
    }

    const originalLabel = el.downloadAllZipBtn.textContent;
    el.downloadAllZipBtn.disabled = true;
    el.downloadAllZipBtn.textContent = "Đang đóng gói ZIP...";

    try {
      const zip = new window.JSZip();
      const usedNames = new Set();

      for (const seg of readySegments) {
        let base = sanitizeFilename(seg.title) || `TAP_${seg.epNumber}`;
        let finalName = `${base}.mp4`;
        let dup = 2;
        while (usedNames.has(finalName.toLowerCase())) {
          finalName = `${base} (${dup++}).mp4`;
        }
        usedNames.add(finalName.toLowerCase());
        zip.file(finalName, seg.blob);
      }

      const zipBlob = await zip.generateAsync(
        { type: "blob", compression: "STORE" },
        (meta) => {
          el.downloadAllZipBtn.textContent = `Đang đóng gói ZIP... ${Math.round(meta.percent)}%`;
        }
      );

      const zipBaseName = sanitizeFilename(el.videoTitleInput.value) || "KAI_TO_VIDEO_CUTTER";
      triggerDownload(zipBlob, `${zipBaseName}_FULL.zip`);
      showToast(`Đã đóng gói và tải xuống ${readySegments.length} tập (.ZIP)!`, "success");
    } catch (err) {
      showAlert(
        `Không thể đóng gói ZIP (video tổng quá lớn so với RAM khả dụng): ${err.message}. Hãy tải riêng từng tập MP4.`,
        "error"
      );
    } finally {
      el.downloadAllZipBtn.disabled = false;
      el.downloadAllZipBtn.textContent = originalLabel;
      updateActionButtons();
    }
  }

  /* ===================== MODAL XEM TRƯỚC & DỌN RAM ===================== */

  function openPreviewModal(segId) {
    const seg = state.segments.find((s) => s.id === segId);
    if (!seg || !seg.blobUrl) return;

    state.modalSegmentId = segId;
    el.modalTitle.textContent = `${sanitizeFilename(seg.title)}.mp4`;
    el.modalMeta.textContent = `Khung giờ: ${formatDuration(seg.startSec)} – ${formatDuration(seg.endSec)} • Thời lượng thực tế: ${formatDuration(seg.actualDuration || seg.expectedDuration)} • Dung lượng: ${formatBytes(seg.outputSize)}`;
    el.modalVideoPlayer.src = seg.blobUrl;
    el.previewModal.classList.remove("hidden");
    el.modalVideoPlayer.play().catch(() => {});
  }

  function closePreviewModal() {
    el.modalVideoPlayer.pause();
    el.modalVideoPlayer.removeAttribute("src");
    el.modalVideoPlayer.load();
    state.modalSegmentId = null;
    el.previewModal.classList.add("hidden");
  }

  function clearAllAndFreeMemory() {
    if (state.isProcessing) {
      cancelCutting();
    }
    revokeSegmentBlobs();
    if (state.sourceUrl) {
      URL.revokeObjectURL(state.sourceUrl);
      state.sourceUrl = null;
    }

    el.sourceVideoPlayer.pause();
    el.sourceVideoPlayer.removeAttribute("src");
    el.sourceVideoPlayer.load();

    terminateWorker();
    setFFmpegBadge("idle", "Đã giải phóng bộ nhớ FFmpeg");

    state.sourceFile = null;
    state.duration = 0;
    state.resolution = "";
    state.segments = [];

    el.videoInput.value = "";
    el.videoInfoSection.classList.add("hidden");
    el.dropZone.classList.remove("hidden");
    el.progressSection.classList.add("hidden");
    el.totalEpisodesCount.textContent = "0 tập";
    showAlert("");

    updateLogoPreviewOnVideo();
    renderEpisodeList();
    updateActionButtons();
    updateRamDisplay();
    notifySegmentsUpdated();
    showToast("Đã xóa video và giải phóng toàn bộ bộ nhớ tạm.", "info");
  }

  /* ===================== GẮN SỰ KIỆN ===================== */

  function bindEvents() {
    el.selectFileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      el.videoInput.click();
    });

    el.dropZone.addEventListener("click", () => el.videoInput.click());
    el.dropZone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        el.videoInput.click();
      }
    });

    el.dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      el.dropZone.classList.add("drag-over");
    });

    el.dropZone.addEventListener("dragleave", () => {
      el.dropZone.classList.remove("drag-over");
    });

    el.dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      el.dropZone.classList.remove("drag-over");
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFileSelected(file);
    });

    el.videoInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelected(file);
    });

    el.sourceVideoPlayer.addEventListener("loadedmetadata", updateLogoPreviewOnVideo);

    el.changeVideoBtn.addEventListener("click", () => el.videoInput.click());
    el.clearMemoryBtn.addEventListener("click", clearAllAndFreeMemory);

    const onChunkChange = () => {
      el.presetBtns.forEach((b) => {
        const isMatch = Number(b.dataset.min) === Number(el.chunkMinutesInput.value) && Number(el.chunkSecondsInput.value) === 0;
        b.classList.toggle("active", isMatch);
      });
      if (!state.isProcessing) recalculateSegments(false);
    };

    el.chunkMinutesInput.addEventListener("input", onChunkChange);
    el.chunkSecondsInput.addEventListener("input", onChunkChange);

    el.presetBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        el.chunkMinutesInput.value = btn.dataset.min;
        el.chunkSecondsInput.value = 0;
        onChunkChange();
      });
    });

    el.modeCopy.addEventListener("change", updateModeVisibility);
    el.modeReencode.addEventListener("change", updateModeVisibility);

    // Sự kiện Logo mờ góc trên trái
    if (el.enableLogoCheckbox) {
      el.enableLogoCheckbox.addEventListener("change", () => {
        state.logo.enabled = el.enableLogoCheckbox.checked;
        saveLogoPrefs();
        updateLogoUI();
      });

      el.selectLogoBtn.addEventListener("click", () => el.logoFileInput.click());
      el.logoFileInput.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (file) handleLogoFileSelected(file);
        el.logoFileInput.value = "";
      });

      el.removeLogoBtn.addEventListener("click", () => {
        state.logo.dataUrl = "";
        state.logo.name = "";
        saveLogoPrefs();
        updateLogoUI();
        showToast("Đã gỡ ảnh logo.", "info");
      });

      el.logoOpacityInput.addEventListener("input", () => {
        state.logo.opacity = Number(el.logoOpacityInput.value) || 45;
        saveLogoPrefs();
        updateLogoUI();
      });

      el.logoSizeInput.addEventListener("input", () => {
        state.logo.sizePct = Number(el.logoSizeInput.value) || 14;
        saveLogoPrefs();
        updateLogoUI();
      });

      el.logoMarginInput.addEventListener("input", () => {
        state.logo.marginPct = Number(el.logoMarginInput.value) || 0;
        saveLogoPrefs();
        updateLogoUI();
      });
    }

    [el.videoTitleInput, el.channelNameInput, el.episodePrefixInput, el.startEpisodeInput].forEach((input) => {
      input.addEventListener("input", () => updateEpisodeNamesOnly(false));
    });
    el.includeChannelCheckbox.addEventListener("change", () => updateEpisodeNamesOnly(false));

    el.resetNamesBtn.addEventListener("click", () => {
      updateEpisodeNamesOnly(true);
      showToast("Đã cập nhật lại tên tự động cho tất cả các tập.", "info");
    });

    el.episodeListContainer.addEventListener("input", (e) => {
      const input = e.target.closest(".ep-name-input");
      if (!input) return;
      const seg = state.segments.find((s) => s.id === input.dataset.segId);
      if (seg) {
        seg.title = input.value;
        seg.customEdited = true;
        notifySegmentsUpdated();
      }
    });

    el.episodeListContainer.addEventListener("click", (e) => {
      const previewBtn = e.target.closest(".btn-preview-ep");
      if (previewBtn) {
        openPreviewModal(previewBtn.dataset.segId);
        return;
      }
      const downloadBtn = e.target.closest(".btn-download-ep");
      if (downloadBtn) {
        downloadSingleEpisode(downloadBtn.dataset.segId);
      }
    });

    el.startCutBtn.addEventListener("click", startCutting);
    el.cancelCutBtn.addEventListener("click", cancelCutting);
    el.downloadAllZipBtn.addEventListener("click", downloadAllAsZip);

    el.toggleLogBtn.addEventListener("click", () => {
      const isHidden = el.logContainer.classList.toggle("hidden");
      el.toggleLogBtn.textContent = isHidden ? "Hiện nhật ký FFmpeg" : "Ẩn nhật ký FFmpeg";
    });

    el.closeModalBtn.addEventListener("click", closePreviewModal);
    el.modalBackdrop.addEventListener("click", closePreviewModal);
    el.modalDownloadBtn.addEventListener("click", () => {
      if (state.modalSegmentId) downloadSingleEpisode(state.modalSegmentId);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !el.previewModal.classList.contains("hidden")) {
        closePreviewModal();
      }
    });
  }

  // Cầu nối xuất dữ liệu sang module Facebook (fb-publisher.js)
  window.KaiToCutter = {
    getSegments: () => state.segments,
    getVideoTitle: () => el.videoTitleInput.value.trim(),
    getChannelName: () => el.channelNameInput.value.trim(),
    getEpisodePrefix: () => el.episodePrefixInput.value.trim() || "TẬP",
    getSourceFileName: () => state.sourceFile?.name || "",
    formatDuration,
    formatBytes,
    showToast,
    showAlert
  };

  restoreLogoPrefs();
  bindEvents();
  updateLogoUI();
  updateNamingSample();
  updateActionButtons();
})();
