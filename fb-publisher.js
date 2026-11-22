/* KAI TỒ VIDEO CUTTER — Module tự động đăng video & ảnh bìa Thumbnail lên Facebook (Meta Graph API) */

(() => {
  "use strict";

  const DEFAULT_BACKEND_URL = "https://kaito-fb-backend.onrender.com";
  const STORAGE_BACKEND_KEY = "kaito_fb_backend_url";
  const STORAGE_SESSION_KEY = "kaito_fb_session_id";
  const STORAGE_PAGE_KEY = "kaito_fb_selected_page_id";

  const fbState = {
    backendUrl: (localStorage.getItem(STORAGE_BACKEND_KEY) || DEFAULT_BACKEND_URL).replace(/\/+$/, ""),
    sessionId: localStorage.getItem(STORAGE_SESSION_KEY) || "",
    connected: false,
    user: null,
    pages: [],
    selectedPageId: localStorage.getItem(STORAGE_PAGE_KEY) || "",
    commonThumb: null, // { dataUrl, mime, name }
    postsByIndex: new Map(),
    isPublishing: false,
    stopRequested: false,
    editingIndex: null,
    editDraftThumb: null // thumbnail tạm trong modal chỉnh sửa
  };

  const ui = {
    backendUrlInput: document.getElementById("fbBackendUrlInput"),
    saveBackendBtn: document.getElementById("fbSaveBackendBtn"),
    connectBtn: document.getElementById("fbConnectBtn"),
    disconnectBtn: document.getElementById("fbDisconnectBtn"),
    connectionBadge: document.getElementById("fbConnectionBadge"),
    userInfo: document.getElementById("fbUserInfo"),
    pageSelectorRow: document.getElementById("fbPageSelectorRow"),
    pageSelect: document.getElementById("fbPageSelect"),
    refreshPagesBtn: document.getElementById("fbRefreshPagesBtn"),

    movieNameInput: document.getElementById("fbMovieNameInput"),
    commonTitleInput: document.getElementById("fbCommonTitleInput"),
    titleTemplateInput: document.getElementById("fbTitleTemplateInput"),
    descriptionInput: document.getElementById("fbDescriptionInput"),
    commonHashtagsInput: document.getElementById("fbCommonHashtagsInput"),
    titlePreviewSample: document.getElementById("fbTitlePreviewSample"),
    applyTemplateAllBtn: document.getElementById("fbApplyTemplateAllBtn"),

    // Thumbnail dùng chung
    commonThumbInput: document.getElementById("fbCommonThumbInput"),
    selectCommonThumbBtn: document.getElementById("fbSelectCommonThumbBtn"),
    removeCommonThumbBtn: document.getElementById("fbRemoveCommonThumbBtn"),
    commonThumbPreview: document.getElementById("fbCommonThumbPreview"),
    commonThumbPlaceholder: document.getElementById("fbCommonThumbPlaceholder"),

    modeNowRadio: document.getElementById("fbDefaultPublishModeNow"),
    modeScheduleRadio: document.getElementById("fbDefaultPublishModeSchedule"),
    autoScheduleBox: document.getElementById("fbAutoScheduleBox"),
    scheduleStartInput: document.getElementById("fbScheduleStartInput"),
    scheduleIntervalHours: document.getElementById("fbScheduleIntervalHours"),
    applyScheduleAllBtn: document.getElementById("fbApplyScheduleAllBtn"),

    startPublishAllBtn: document.getElementById("fbStartPublishAllBtn"),
    retryFailedBtn: document.getElementById("fbRetryFailedBtn"),
    stopQueueBtn: document.getElementById("fbStopQueueBtn"),
    queueStatusText: document.getElementById("fbQueueStatusText"),
    queueListContainer: document.getElementById("fbQueueListContainer"),

    // Modal chỉnh sửa từng tập
    editModal: document.getElementById("fbEditModal"),
    editBackdrop: document.getElementById("fbEditBackdrop"),
    editCloseBtn: document.getElementById("fbEditCloseBtn"),
    editEpisodeLabel: document.getElementById("fbEditEpisodeLabel"),
    editTitleInput: document.getElementById("fbEditTitleInput"),
    editDescInput: document.getElementById("fbEditDescInput"),
    editCustomTagsInput: document.getElementById("fbEditCustomTagsInput"),
    editThumbInput: document.getElementById("fbEditThumbInput"),
    editThumbPreview: document.getElementById("fbEditThumbPreview"),
    editThumbPlaceholder: document.getElementById("fbEditThumbPlaceholder"),
    editThumbHint: document.getElementById("fbEditThumbHint"),
    editSelectThumbBtn: document.getElementById("fbEditSelectThumbBtn"),
    editCaptureThumbBtn: document.getElementById("fbEditCaptureThumbBtn"),
    editResetThumbBtn: document.getElementById("fbEditResetThumbBtn"),
    editPublishMode: document.getElementById("fbEditPublishMode"),
    editScheduleGroup: document.getElementById("fbEditScheduleGroup"),
    editScheduleInput: document.getElementById("fbEditScheduleInput"),
    editSaveBtn: document.getElementById("fbEditSaveBtn")
  };

  if (!ui.connectBtn) return;

  function cutter() {
    return window.KaiToCutter || {
      getSegments: () => [],
      getVideoTitle: () => "",
      getChannelName: () => "KAI TỒ REVIEW",
      getEpisodePrefix: () => "TẬP",
      getSourceFileName: () => "",
      formatDuration: (s) => `${Math.round(s)}s`,
      formatBytes: (b) => `${(b / 1048576).toFixed(1)} MB`,
      showToast: (m) => alert(m),
      showAlert: () => {}
    };
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toLocalDatetimeInputValue(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  }

  function formatDisplayDatetime(value) {
    if (!value) return "Chưa đặt giờ";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "Giờ không hợp lệ";
    return d.toLocaleString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  }

  function getSelectedPageName() {
    const p = fbState.pages.find((x) => x.id === fbState.selectedPageId);
    return p ? p.name : "Chưa chọn Fanpage";
  }

  /* ===================== XỬ LÝ ẢNH THUMBNAIL ===================== */

  // Chuẩn hóa ảnh chọn từ máy sang JPEG tối đa 1920px để Meta luôn nhận mượt
  function imageFileToJpeg(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) {
        reject(new Error("Vui lòng chọn đúng file ảnh (JPG, PNG, WEBP)."));
        return;
      }

      const url = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        try {
          const maxSide = 1920;
          let w = img.naturalWidth || 1280;
          let h = img.naturalHeight || 720;
          if (w > maxSide || h > maxSide) {
            const ratio = Math.min(maxSide / w, maxSide / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }

          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);

          const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
          URL.revokeObjectURL(url);
          resolve({
            dataUrl,
            mime: "image/jpeg",
            name: file.name
          });
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Không đọc được file ảnh này."));
      };

      img.src = url;
    });
  }

  // Chụp 1 khung hình từ file video MP4 đã cắt để làm ảnh bìa
  function captureFrameFromVideo(blobUrl) {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = blobUrl;

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Quá thời gian chụp khung hình từ video."));
      }, 10000);

      function cleanup() {
        clearTimeout(timer);
        video.onloadeddata = null;
        video.onseeked = null;
        video.onerror = null;
      }

      video.onloadeddata = () => {
        const targetTime = Number.isFinite(video.duration) && video.duration > 2
          ? Math.min(5, video.duration * 0.15)
          : 0.2;
        video.currentTime = targetTime;
      };

      video.onseeked = () => {
        try {
          const maxSide = 1920;
          let w = video.videoWidth || 1280;
          let h = video.videoHeight || 720;
          if (w > maxSide || h > maxSide) {
            const ratio = Math.min(maxSide / w, maxSide / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
          cleanup();
          resolve({
            dataUrl,
            mime: "image/jpeg",
            name: "frame_from_video.jpg"
          });
        } catch (err) {
          cleanup();
          reject(err);
        }
      };

      video.onerror = () => {
        cleanup();
        reject(new Error("Không thể đọc khung hình từ video này."));
      };
    });
  }

  function updateCommonThumbUI() {
    if (fbState.commonThumb) {
      ui.commonThumbPreview.src = fbState.commonThumb.dataUrl;
      ui.commonThumbPreview.classList.remove("hidden");
      ui.commonThumbPlaceholder.classList.add("hidden");
      ui.removeCommonThumbBtn.classList.remove("hidden");
    } else {
      ui.commonThumbPreview.removeAttribute("src");
      ui.commonThumbPreview.classList.add("hidden");
      ui.commonThumbPlaceholder.classList.remove("hidden");
      ui.removeCommonThumbBtn.classList.add("hidden");
    }
    renderQueue();
  }

  function updateEditThumbUI() {
    const activeThumb = fbState.editDraftThumb || fbState.commonThumb;
    if (activeThumb) {
      ui.editThumbPreview.src = activeThumb.dataUrl;
      ui.editThumbPreview.classList.remove("hidden");
      ui.editThumbPlaceholder.classList.add("hidden");
    } else {
      ui.editThumbPreview.removeAttribute("src");
      ui.editThumbPreview.classList.add("hidden");
      ui.editThumbPlaceholder.classList.remove("hidden");
    }

    if (fbState.editDraftThumb) {
      ui.editThumbHint.textContent = `Đang dùng ảnh bìa riêng (${fbState.editDraftThumb.name}).`;
      ui.editResetThumbBtn.classList.remove("hidden");
    } else if (fbState.commonThumb) {
      ui.editThumbHint.textContent = "Đang dùng ảnh bìa chung của bộ phim.";
      ui.editResetThumbBtn.classList.add("hidden");
    } else {
      ui.editThumbHint.textContent = "Chưa chọn ảnh bìa (Facebook sẽ tự lấy khung hình mặc định).";
      ui.editResetThumbBtn.classList.add("hidden");
    }
  }

  function getEffectiveThumb(post) {
    if (post && post.customThumb) {
      return { thumb: post.customThumb, label: "Ảnh bìa riêng" };
    }
    if (fbState.commonThumb) {
      return { thumb: fbState.commonThumb, label: "Ảnh bìa chung" };
    }
    return { thumb: null, label: "Mặc định FB" };
  }

  /* ===================== KẾT NỐI BACKEND & OAUTH ===================== */

  async function apiFetch(path, options = {}) {
    if (!fbState.backendUrl) {
      throw new Error("Vui lòng nhập và lưu địa chỉ Backend trước.");
    }
    const headers = Object.assign({}, options.headers || {});
    if (fbState.sessionId) {
      headers.Authorization = `Bearer ${fbState.sessionId}`;
    }
    const res = await fetch(`${fbState.backendUrl}${path}`, {
      ...options,
      headers
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Lỗi máy chủ (HTTP ${res.status})`);
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  }

  function updateConnectionUI() {
    if (fbState.connected && fbState.user) {
      ui.connectionBadge.className = "status-pill status-ready";
      ui.userInfo.textContent = `Đã kết nối: ${fbState.user.name} (${fbState.pages.length} Fanpage)`;
      ui.connectBtn.textContent = "Đổi tài khoản Facebook";
      ui.disconnectBtn.classList.remove("hidden");
      ui.pageSelectorRow.classList.remove("hidden");

      ui.pageSelect.innerHTML = `<option value="">-- Chọn Fanpage muốn đăng --</option>`;
      fbState.pages.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = `${p.name} (ID: ${p.id})`;
        if (p.id === fbState.selectedPageId) opt.selected = true;
        ui.pageSelect.appendChild(opt);
      });

      if (!fbState.selectedPageId && fbState.pages.length === 1) {
        fbState.selectedPageId = fbState.pages[0].id;
        localStorage.setItem(STORAGE_PAGE_KEY, fbState.selectedPageId);
        ui.pageSelect.value = fbState.selectedPageId;
      }
    } else {
      ui.connectionBadge.className = "status-pill status-idle";
      ui.userInfo.textContent = "Chưa kết nối Facebook";
      ui.connectBtn.textContent = "Kết nối Facebook";
      ui.disconnectBtn.classList.add("hidden");
      ui.pageSelectorRow.classList.add("hidden");
    }
    renderQueue();
  }

  async function restoreSession() {
    if (!fbState.backendUrl || !fbState.sessionId) {
      fbState.connected = false;
      updateConnectionUI();
      return;
    }

    try {
      ui.connectionBadge.className = "status-pill status-loading";
      ui.userInfo.textContent = "Đang kiểm tra kết nối Facebook...";
      const data = await apiFetch("/api/facebook/session");
      fbState.connected = true;
      fbState.user = data.user;
      fbState.pages = data.pages || [];
      updateConnectionUI();
    } catch (_) {
      fbState.connected = false;
      fbState.user = null;
      fbState.pages = [];
      fbState.sessionId = "";
      localStorage.removeItem(STORAGE_SESSION_KEY);
      updateConnectionUI();
    }
  }

  function handleOAuthReturnFromHash() {
    const hash = window.location.hash || "";
    if (!hash.includes("fb_session=") && !hash.includes("fb_error=")) return;

    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const session = params.get("fb_session");
    const err = params.get("fb_error");

    window.history.replaceState(null, "", window.location.pathname + window.location.search);

    if (err) {
      cutter().showAlert(`Kết nối Facebook thất bại: ${err}`, "error");
      return;
    }

    if (session) {
      fbState.sessionId = session;
      localStorage.setItem(STORAGE_SESSION_KEY, session);
      cutter().showToast("Đã kết nối Facebook thành công!", "success");
    }
  }

  /* ===================== TẠO TIÊU ĐỀ, MÔ TẢ & HASHTAG ===================== */

  function buildFbTitle(epNumber) {
    const movie = ui.movieNameInput.value.trim() || cutter().getVideoTitle() || "VIDEO";
    const commonTitle = ui.commonTitleInput.value.trim();
    const prefix = cutter().getEpisodePrefix() || "TẬP";
    const numStr = String(epNumber).padStart(2, "0");
    const tapLabel = `${prefix} ${numStr}`;
    const template = ui.titleTemplateInput.value.trim() || "{TAP} - {TEN_PHIM}";

    return template
      .replace(/\{TAP\}/gi, tapLabel)
      .replace(/\{SO_TAP\}/gi, numStr)
      .replace(/\{TEN_PHIM\}/gi, movie)
      .replace(/\{TIEU_DE_CHUNG\}/gi, commonTitle)
      .replace(/\{KENH\}/gi, cutter().getChannelName())
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildBaseDescription() {
    const commonTitle = ui.commonTitleInput.value.trim();
    const desc = ui.descriptionInput.value.trim();
    return [commonTitle, desc].filter(Boolean).join("\n\n");
  }

  function buildFullDescriptionWithHashtags(post) {
    const parts = [];
    if (post.fbDescription && post.fbDescription.trim()) {
      parts.push(post.fbDescription.trim());
    }
    const tags = [ui.commonHashtagsInput.value.trim(), (post.customHashtags || "").trim()]
      .filter(Boolean)
      .join(" ");
    if (tags) {
      parts.push(tags);
    }
    return parts.join("\n\n");
  }

  function updateTitlePreview() {
    const segs = cutter().getSegments();
    const firstEp = segs.length > 0 ? segs[0].epNumber : 1;
    ui.titlePreviewSample.textContent = buildFbTitle(firstEp);
  }

  function syncPostsWithSegments(forceResetAll = false) {
    const segs = cutter().getSegments();
    const sourceName = cutter().getSourceFileName();

    if (!ui.movieNameInput.value.trim() && cutter().getVideoTitle()) {
      ui.movieNameInput.value = cutter().getVideoTitle();
    }

    const defaultMode = ui.modeScheduleRadio.checked ? "schedule" : "now";
    const validIndices = new Set(segs.map((s) => s.index));

    for (const key of fbState.postsByIndex.keys()) {
      if (!validIndices.has(key)) {
        fbState.postsByIndex.delete(key);
      }
    }

    segs.forEach((seg) => {
      const existing = fbState.postsByIndex.get(seg.index);
      const idempotencyKey = `${sourceName}_${seg.index}_${Math.round(seg.startSec)}_${Math.round(seg.endSec)}`;

      if (!existing) {
        fbState.postsByIndex.set(seg.index, {
          index: seg.index,
          epNumber: seg.epNumber,
          fbTitle: buildFbTitle(seg.epNumber),
          fbDescription: buildBaseDescription(),
          customHashtags: "",
          customThumb: null,
          customEdited: false,
          publishMode: defaultMode,
          scheduledAt: "",
          status: "pending",
          uploadPercent: 0,
          errorMessage: "",
          videoId: "",
          permalinkUrl: "",
          idempotencyKey
        });
      } else {
        existing.epNumber = seg.epNumber;
        if (existing.idempotencyKey !== idempotencyKey) {
          existing.idempotencyKey = idempotencyKey;
          existing.status = "pending";
          existing.uploadPercent = 0;
          existing.errorMessage = "";
          existing.videoId = "";
          existing.permalinkUrl = "";
        }
        if (forceResetAll || !existing.customEdited) {
          existing.fbTitle = buildFbTitle(seg.epNumber);
          existing.fbDescription = buildBaseDescription();
          if (forceResetAll) existing.customEdited = false;
        }
      }
    });

    updateTitlePreview();
    renderQueue();
  }

  function applyAutoSchedule() {
    const segs = cutter().getSegments();
    if (segs.length === 0) {
      cutter().showToast("Chưa có danh sách tập để rải lịch.", "warn");
      return;
    }

    let startMs = new Date(ui.scheduleStartInput.value).getTime();
    if (!Number.isFinite(startMs)) {
      startMs = Date.now() + 20 * 60 * 1000;
      ui.scheduleStartInput.value = toLocalDatetimeInputValue(new Date(startMs));
    }
    if (startMs < Date.now() + 11 * 60 * 1000) {
      cutter().showToast("Facebook yêu cầu lịch đăng phải cách hiện tại ít nhất 10 phút.", "warn");
      return;
    }

    const stepHours = Math.max(0.5, parseFloat(ui.scheduleIntervalHours.value) || 2);
    segs.forEach((seg, i) => {
      const post = fbState.postsByIndex.get(seg.index);
      if (!post || post.status === "posted") return;
      post.publishMode = "schedule";
      post.scheduledAt = toLocalDatetimeInputValue(new Date(startMs + i * stepHours * 3600 * 1000));
    });

    renderQueue();
    cutter().showToast(`Đã rải lịch tự động cho ${segs.length} tập (cách nhau ${stepHours} giờ).`, "success");
  }

  /* ===================== HIỂN THỊ BẢNG QUẢN LÝ TRƯỚC KHI ĐĂNG ===================== */

  function getFbStatusBadge(post) {
    if (post.status === "uploading") {
      return `<span class="badge badge-processing">Đang đăng (${post.uploadPercent}%)</span>`;
    }
    if (post.status === "posted") {
      return `<span class="badge badge-success">Đã đăng</span>`;
    }
    if (post.status === "failed") {
      return `<span class="badge badge-error">Đăng thất bại</span>`;
    }
    return `<span class="badge badge-idle">Chờ đăng</span>`;
  }

  function updateQueueButtons() {
    const segs = cutter().getSegments();
    const readyToPostCount = segs.filter((s) => {
      const p = fbState.postsByIndex.get(s.index);
      return s.status === "done" && s.blob && p && p.status !== "posted";
    }).length;

    const failedCount = segs.filter((s) => {
      const p = fbState.postsByIndex.get(s.index);
      return s.status === "done" && s.blob && p && p.status === "failed";
    }).length;

    const canPublish = fbState.connected && Boolean(fbState.selectedPageId) && readyToPostCount > 0 && !fbState.isPublishing;

    ui.startPublishAllBtn.disabled = !canPublish;
    ui.retryFailedBtn.classList.toggle("hidden", failedCount === 0 || fbState.isPublishing);
    ui.stopQueueBtn.classList.toggle("hidden", !fbState.isPublishing);

    if (!fbState.connected) {
      ui.queueStatusText.textContent = "Chưa kết nối Facebook. Bạn vẫn cắt & tải video bình thường, hoặc kết nối Facebook để đăng tự động.";
    } else if (!fbState.selectedPageId) {
      ui.queueStatusText.textContent = "Hãy chọn Fanpage muốn đăng ở phía trên.";
    } else if (segs.length === 0) {
      ui.queueStatusText.textContent = "Hãy chọn video ở Bước 1 để tạo danh sách tập.";
    } else if (readyToPostCount === 0) {
      const postedCount = segs.filter((s) => fbState.postsByIndex.get(s.index)?.status === "posted").length;
      ui.queueStatusText.textContent =
        postedCount === segs.length && segs.length > 0
          ? `Toàn bộ ${postedCount} tập đã được đăng lên Fanpage "${getSelectedPageName()}".`
          : "Hãy bấm 'Bắt đầu chia video' ở Bước 2 để tạo các file MP4 trước khi đăng lên Facebook.";
    } else {
      ui.queueStatusText.textContent = `Sẵn sàng đăng ${readyToPostCount} tập MP4 lên Fanpage "${getSelectedPageName()}".`;
    }
  }

  function renderQueue() {
    const segs = cutter().getSegments();
    if (segs.length === 0) {
      ui.queueListContainer.innerHTML =
        `<div class="empty-state">Chưa có tập video nào. Hãy chọn video ở Bước 1 để hệ thống tự động tạo danh sách bài đăng.</div>`;
      updateQueueButtons();
      return;
    }

    const pageName = getSelectedPageName();
    const commonTags = ui.commonHashtagsInput.value.trim();
    const frag = document.createDocumentFragment();

    segs.forEach((seg) => {
      const post = fbState.postsByIndex.get(seg.index);
      if (!post) return;

      const card = document.createElement("div");
      card.className = `fb-queue-card fb-${post.status}`;

      const hasVideo = seg.status === "done" && Boolean(seg.blob);
      const videoInfoText = hasVideo
        ? `Sẵn sàng (${cutter().formatBytes(seg.outputSize)})`
        : "Chưa cắt video MP4";

      const allTags = [commonTags, post.customHashtags].filter(Boolean).join(" ");
      const scheduleLabel =
        post.publishMode === "schedule"
          ? `Hẹn lịch: ${formatDisplayDatetime(post.scheduledAt)}`
          : "Đăng ngay lập tức";

      const { thumb, label: thumbLabel } = getEffectiveThumb(post);
      const thumbHtml = thumb
        ? `<img src="${thumb.dataUrl}" alt="Ảnh bìa tập ${post.epNumber}" />`
        : `<span class="fb-thumb-placeholder">Chưa chọn ảnh</span>`;

      const permalinkHtml = post.permalinkUrl
        ? `<div><a class="fb-link-btn" href="${escapeHtml(post.permalinkUrl)}" target="_blank" rel="noopener noreferrer">Mở bài đăng trên Facebook ↗</a></div>`
        : "";

      const errorHtml = post.errorMessage
        ? `<div style="color:#f87171;font-size:0.8rem;">Lỗi: ${escapeHtml(post.errorMessage)}</div>`
        : "";

      const canSinglePost = fbState.connected && Boolean(fbState.selectedPageId) && hasVideo && !fbState.isPublishing && post.status !== "posted";

      card.innerHTML = `
        <div class="fb-queue-thumb">
          <div class="fb-queue-thumb-frame">${thumbHtml}</div>
          <span class="fb-queue-thumb-tag">${escapeHtml(thumbLabel)}</span>
        </div>

        <div>
          <div class="fb-post-title">${escapeHtml(post.fbTitle)}</div>
          <div class="fb-post-desc">${escapeHtml(post.fbDescription || "(Chưa có mô tả)")}</div>
          <div class="fb-post-tags">${escapeHtml(allTags || "(Chưa có hashtag)")}</div>
          ${errorHtml}
        </div>

        <div class="fb-meta-col">
          <div><strong>Tập:</strong> ${escapeHtml(seg.title)}.mp4</div>
          <div><strong>Video MP4:</strong> ${videoInfoText}</div>
          <div><strong>Fanpage:</strong> ${escapeHtml(pageName)}</div>
          <div><strong>Thời gian:</strong> ${escapeHtml(scheduleLabel)}</div>
          <div>${getFbStatusBadge(post)}</div>
          ${permalinkHtml}
        </div>

        <div class="ep-actions-col">
          <button
            type="button"
            class="btn btn-secondary btn-sm btn-fb-edit"
            data-index="${seg.index}"
            ${fbState.isPublishing || post.status === "posted" ? "disabled" : ""}
          >Chỉnh sửa</button>
          <button
            type="button"
            class="btn ${post.status === "failed" ? "btn-danger" : "btn-fb"} btn-sm btn-fb-single"
            data-index="${seg.index}"
            ${canSinglePost ? "" : "disabled"}
          >${post.status === "failed" ? "Thử đăng lại" : "Đăng tập này"}</button>
        </div>
      `;

      frag.appendChild(card);
    });

    ui.queueListContainer.innerHTML = "";
    ui.queueListContainer.appendChild(frag);
    updateQueueButtons();
  }

  /* ===================== UPLOAD VIDEO + THUMBNAIL LÊN FACEBOOK ===================== */

  async function publishSingleEpisode(seg) {
    const post = fbState.postsByIndex.get(seg.index);
    if (!post || !seg.blob) return;
    if (post.status === "posted") return;

    let scheduledUnix = null;
    if (post.publishMode === "schedule") {
      const dt = new Date(post.scheduledAt);
      const unix = Math.floor(dt.getTime() / 1000);
      const now = Math.floor(Date.now() / 1000);
      if (!post.scheduledAt || Number.isNaN(unix) || unix < now + 600 || unix > now + 180 * 86400) {
        post.status = "failed";
        post.errorMessage = "Thời gian hẹn lịch phải cách hiện tại từ 10 phút đến 6 tháng.";
        renderQueue();
        return;
      }
      scheduledUnix = unix;
    }

    post.status = "uploading";
    post.uploadPercent = 2;
    post.errorMessage = "";
    renderQueue();

    try {
      const pageId = fbState.selectedPageId;
      const blob = seg.blob;

      // Pha 1: Start
      const startRes = await apiFetch("/api/facebook/upload/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageId,
          fileSize: blob.size,
          idempotencyKey: post.idempotencyKey
        })
      });

      const uploadSessionId = startRes.upload_session_id;
      const videoId = startRes.video_id;
      let startOffset = Number(startRes.start_offset);
      let endOffset = Number(startRes.end_offset);

      // Pha 2: Transfer từng mảnh
      while (startOffset < endOffset) {
        if (fbState.stopRequested) {
          throw new Error("Người dùng đã dừng hàng đợi đăng bài.");
        }

        const chunk = blob.slice(startOffset, endOffset);
        const chunkBuffer = await chunk.arrayBuffer();

        const transferRes = await apiFetch("/api/facebook/upload/transfer", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-page-id": pageId,
            "x-upload-session-id": uploadSessionId,
            "x-start-offset": String(startOffset)
          },
          body: chunkBuffer
        });

        startOffset = Number(transferRes.start_offset);
        endOffset = Number(transferRes.end_offset);
        post.uploadPercent = Math.min(95, Math.max(5, Math.round((startOffset / blob.size) * 95)));
        renderQueue();
      }

      // Pha 3: Finish + đính kèm ảnh bìa (Thumbnail)
      post.uploadPercent = 98;
      renderQueue();

      const { thumb } = getEffectiveThumb(post);

      const finishRes = await apiFetch("/api/facebook/upload/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageId,
          uploadSessionId,
          videoId,
          title: post.fbTitle,
          description: buildFullDescriptionWithHashtags(post),
          publishMode: post.publishMode,
          scheduledPublishTime: scheduledUnix,
          idempotencyKey: post.idempotencyKey,
          thumbnailBase64: thumb ? thumb.dataUrl : "",
          thumbnailMime: thumb ? thumb.mime : ""
        })
      });

      if (finishRes.success !== true) {
        throw new Error("Facebook không trả về xác nhận đăng thành công.");
      }

      post.status = "posted";
      post.uploadPercent = 100;
      post.videoId = finishRes.videoId || videoId;
      post.permalinkUrl = finishRes.permalinkUrl || "";
      post.errorMessage = "";
      cutter().showToast(`Đã đăng thành công: ${post.fbTitle}`, "success");
    } catch (err) {
      if (err.payload && err.payload.alreadyPublished) {
        post.status = "posted";
        post.videoId = err.payload.videoId || "";
        post.permalinkUrl = err.payload.permalinkUrl || "";
        post.errorMessage = "";
      } else {
        post.status = "failed";
        post.errorMessage = err.message || "Đăng thất bại.";
      }
    }

    renderQueue();
  }

  async function runPublishQueue(onlyFailed = false) {
    if (fbState.isPublishing) return;
    if (!fbState.connected || !fbState.selectedPageId) {
      cutter().showToast("Hãy kết nối Facebook và chọn Fanpage trước.", "warn");
      return;
    }

    const targets = cutter()
      .getSegments()
      .filter((seg) => {
        const post = fbState.postsByIndex.get(seg.index);
        if (!seg.blob || seg.status !== "done" || !post) return false;
        if (onlyFailed) return post.status === "failed";
        return post.status !== "posted";
      });

    if (targets.length === 0) {
      cutter().showToast("Không có tập nào sẵn sàng để đăng.", "info");
      return;
    }

    fbState.isPublishing = true;
    fbState.stopRequested = false;
    renderQueue();

    for (const seg of targets) {
      if (fbState.stopRequested) break;
      await publishSingleEpisode(seg);
    }

    fbState.isPublishing = false;
    fbState.stopRequested = false;
    renderQueue();
  }

  /* ===================== MODAL CHỈNH SỬA TỪNG TẬP ===================== */

  function openEditModal(index) {
    const post = fbState.postsByIndex.get(index);
    const seg = cutter().getSegments().find((s) => s.index === index);
    if (!post) return;

    fbState.editingIndex = index;
    fbState.editDraftThumb = post.customThumb ? { ...post.customThumb } : null;

    ui.editEpisodeLabel.textContent = `Chỉnh sửa bài đăng — Tập ${String(post.epNumber).padStart(2, "0")}`;
    ui.editTitleInput.value = post.fbTitle;
    ui.editDescInput.value = post.fbDescription;
    ui.editCustomTagsInput.value = post.customHashtags;
    ui.editPublishMode.value = post.publishMode;
    ui.editScheduleInput.value = post.scheduledAt || toLocalDatetimeInputValue(new Date(Date.now() + 30 * 60 * 1000));
    ui.editScheduleGroup.classList.toggle("hidden", post.publishMode !== "schedule");

    // Bật nút "Chụp từ video tập này" nếu tập đó đã cắt ra file MP4
    ui.editCaptureThumbBtn.disabled = !(seg && seg.blobUrl);
    ui.editThumbInput.value = "";
    updateEditThumbUI();

    ui.editModal.classList.remove("hidden");
  }

  function closeEditModal() {
    fbState.editingIndex = null;
    fbState.editDraftThumb = null;
    ui.editModal.classList.add("hidden");
  }

  function saveEditModal() {
    if (fbState.editingIndex === null) return;
    const post = fbState.postsByIndex.get(fbState.editingIndex);
    if (!post) return;

    post.fbTitle = ui.editTitleInput.value.trim() || buildFbTitle(post.epNumber);
    post.fbDescription = ui.editDescInput.value.trim();
    post.customHashtags = ui.editCustomTagsInput.value.trim();
    post.customThumb = fbState.editDraftThumb ? { ...fbState.editDraftThumb } : null;
    post.publishMode = ui.editPublishMode.value;
    post.scheduledAt = post.publishMode === "schedule" ? ui.editScheduleInput.value : "";
    post.customEdited = true;

    closeEditModal();
    renderQueue();
    cutter().showToast("Đã cập nhật nội dung & ảnh bìa bài đăng Facebook.", "success");
  }

  /* ===================== GẮN SỰ KIỆN ===================== */

  function init() {
    ui.backendUrlInput.value = fbState.backendUrl;
    ui.scheduleStartInput.value = toLocalDatetimeInputValue(new Date(Date.now() + 30 * 60 * 1000));

    handleOAuthReturnFromHash();
    restoreSession();

    ui.saveBackendBtn.addEventListener("click", async () => {
      const url = ui.backendUrlInput.value.trim().replace(/\/+$/, "");
      if (!/^https?:\/\/.+/.test(url)) {
        cutter().showToast("Địa chỉ Backend phải bắt đầu bằng https:// hoặc http://", "error");
        return;
      }
      fbState.backendUrl = url;
      localStorage.setItem(STORAGE_BACKEND_KEY, url);
      try {
        const res = await fetch(`${url}/health`);
        if (!res.ok) throw new Error();
        cutter().showToast("Đã kết nối tới Backend thành công!", "success");
        restoreSession();
      } catch {
        cutter().showToast("Đã lưu địa chỉ nhưng chưa gọi được /health (Backend có thể đang khởi động).", "warn");
      }
    });

    ui.connectBtn.addEventListener("click", () => {
      const url = ui.backendUrlInput.value.trim().replace(/\/+$/, "") || fbState.backendUrl;
      if (!url) {
        cutter().showToast("Hãy nhập và lưu địa chỉ Backend trước khi kết nối Facebook.", "warn");
        ui.backendUrlInput.focus();
        return;
      }
      fbState.backendUrl = url;
      localStorage.setItem(STORAGE_BACKEND_KEY, url);
      window.location.href = `${url}/auth/facebook/login`;
    });

    ui.disconnectBtn.addEventListener("click", async () => {
      try {
        await apiFetch("/api/facebook/logout", { method: "POST" });
      } catch (_) {}
      fbState.connected = false;
      fbState.user = null;
      fbState.pages = [];
      fbState.sessionId = "";
      localStorage.removeItem(STORAGE_SESSION_KEY);
      updateConnectionUI();
      cutter().showToast("Đã ngắt kết nối Facebook và xóa phiên trên server.", "info");
    });

    ui.pageSelect.addEventListener("change", () => {
      fbState.selectedPageId = ui.pageSelect.value;
      localStorage.setItem(STORAGE_PAGE_KEY, fbState.selectedPageId);
      renderQueue();
    });

    ui.refreshPagesBtn.addEventListener("click", async () => {
      try {
        const data = await apiFetch("/api/facebook/refresh-pages", { method: "POST" });
        fbState.pages = data.pages || [];
        updateConnectionUI();
        cutter().showToast(`Đã làm mới danh sách (${fbState.pages.length} Fanpage).`, "success");
      } catch (err) {
        cutter().showToast(err.message, "error");
      }
    });

    // Sự kiện ảnh bìa dùng chung
    ui.selectCommonThumbBtn.addEventListener("click", () => ui.commonThumbInput.click());
    ui.commonThumbInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        fbState.commonThumb = await imageFileToJpeg(file);
        updateCommonThumbUI();
        cutter().showToast("Đã thêm ảnh bìa (Thumbnail) chung cho tất cả các tập.", "success");
      } catch (err) {
        cutter().showToast(err.message, "error");
      }
      ui.commonThumbInput.value = "";
    });

    ui.removeCommonThumbBtn.addEventListener("click", () => {
      fbState.commonThumb = null;
      updateCommonThumbUI();
      cutter().showToast("Đã gỡ ảnh bìa chung.", "info");
    });

    // Sự kiện ảnh bìa riêng trong modal chỉnh sửa
    ui.editSelectThumbBtn.addEventListener("click", () => ui.editThumbInput.click());
    ui.editThumbInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        fbState.editDraftThumb = await imageFileToJpeg(file);
        updateEditThumbUI();
        cutter().showToast("Đã chọn ảnh bìa riêng cho tập này.", "success");
      } catch (err) {
        cutter().showToast(err.message, "error");
      }
      ui.editThumbInput.value = "";
    });

    ui.editCaptureThumbBtn.addEventListener("click", async () => {
      if (fbState.editingIndex === null) return;
      const seg = cutter().getSegments().find((s) => s.index === fbState.editingIndex);
      if (!seg || !seg.blobUrl) {
        cutter().showToast("Hãy cắt video trước để chụp khung hình từ tập này.", "warn");
        return;
      }
      try {
        ui.editCaptureThumbBtn.disabled = true;
        ui.editCaptureThumbBtn.textContent = "Đang chụp...";
        fbState.editDraftThumb = await captureFrameFromVideo(seg.blobUrl);
        updateEditThumbUI();
        cutter().showToast("Đã chụp khung hình từ video làm ảnh bìa!", "success");
      } catch (err) {
        cutter().showToast(err.message, "error");
      } finally {
        ui.editCaptureThumbBtn.disabled = false;
        ui.editCaptureThumbBtn.textContent = "Chụp từ video tập này";
      }
    });

    ui.editResetThumbBtn.addEventListener("click", () => {
      fbState.editDraftThumb = null;
      updateEditThumbUI();
    });

    [ui.movieNameInput, ui.commonTitleInput, ui.titleTemplateInput, ui.descriptionInput, ui.commonHashtagsInput].forEach((input) => {
      input.addEventListener("input", () => syncPostsWithSegments(false));
    });

    ui.applyTemplateAllBtn.addEventListener("click", () => {
      syncPostsWithSegments(true);
      cutter().showToast("Đã áp dụng lại tiêu đề và mô tả mới cho tất cả các tập.", "info");
    });

    const onDefaultModeChange = () => {
      const isSchedule = ui.modeScheduleRadio.checked;
      ui.autoScheduleBox.classList.toggle("hidden", !isSchedule);
      fbState.postsByIndex.forEach((p) => {
        if (p.status !== "posted" && !p.customEdited) {
          p.publishMode = isSchedule ? "schedule" : "now";
        }
      });
      renderQueue();
    };
    ui.modeNowRadio.addEventListener("change", onDefaultModeChange);
    ui.modeScheduleRadio.addEventListener("change", onDefaultModeChange);
    ui.applyScheduleAllBtn.addEventListener("click", applyAutoSchedule);

    ui.startPublishAllBtn.addEventListener("click", () => runPublishQueue(false));
    ui.retryFailedBtn.addEventListener("click", () => runPublishQueue(true));
    ui.stopQueueBtn.addEventListener("click", () => {
      fbState.stopRequested = true;
      cutter().showToast("Đang dừng sau khi mảnh hiện tại hoàn tất...", "warn");
    });

    ui.queueListContainer.addEventListener("click", async (e) => {
      const editBtn = e.target.closest(".btn-fb-edit");
      if (editBtn) {
        openEditModal(Number(editBtn.dataset.index));
        return;
      }
      const singleBtn = e.target.closest(".btn-fb-single");
      if (singleBtn && !fbState.isPublishing) {
        const idx = Number(singleBtn.dataset.index);
        const seg = cutter().getSegments().find((s) => s.index === idx);
        if (!seg) return;
        fbState.isPublishing = true;
        fbState.stopRequested = false;
        renderQueue();
        await publishSingleEpisode(seg);
        fbState.isPublishing = false;
        renderQueue();
      }
    });

    ui.editPublishMode.addEventListener("change", () => {
      ui.editScheduleGroup.classList.toggle("hidden", ui.editPublishMode.value !== "schedule");
    });
    ui.editCloseBtn.addEventListener("click", closeEditModal);
    ui.editBackdrop.addEventListener("click", closeEditModal);
    ui.editSaveBtn.addEventListener("click", saveEditModal);

    window.addEventListener("kaito:segments-updated", () => syncPostsWithSegments(false));
    syncPostsWithSegments(false);
  }

  init();
})();
