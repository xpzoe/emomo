import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const STORAGE_KEY = "emomo.web.records.v2";
const SETTINGS_KEY = "emomo.web.settings.v1";
const SYNC_STATE_KEY = "emomo.web.sync.v1";

const MOODS = [
  { key: "happy", emoji: "😊", label: "开心", detail: "开心/愉悦", color: "#ffd166" },
  { key: "angry", emoji: "😡", label: "暴躁", detail: "愤怒/暴躁", color: "#ff8a80" },
  { key: "sad", emoji: "😭", label: "难过", detail: "难过/委屈", color: "#8ec5ff" },
  { key: "down", emoji: "😞", label: "丧", detail: "丧/低落", color: "#a7a9be" },
  { key: "calm", emoji: "😌", label: "平静", detail: "平静/稳定", color: "#8ee0b7" },
  { key: "tired", emoji: "😴", label: "困倦", detail: "困倦/无动力", color: "#c6b6ff" },
];

const RANGE_OPTIONS = [
  { key: "7d", label: "7天", days: 7 },
  { key: "30d", label: "30天", days: 30 },
  { key: "90d", label: "90天", days: 90 },
  { key: "12m", label: "12月", days: 365 },
];

const DEFAULT_SETTINGS = {
  reminderEnabled: false,
  reminderMessage: "emomo 到点，现在的你是什么情绪？",
  reminderTimes: [
    { id: "afternoon", hour: 15, minute: 0 },
    { id: "night", hour: 21, minute: 0 },
  ],
};

const REGULATION_TIPS = {
  ok: ["看向远处 30 秒。", "喝一口水，慢一点。", "换一个更舒服的姿势。"],
  watch: ["慢慢呼吸 5 次。", "把肩膀轻轻放下来。", "离开屏幕 3 分钟。"],
  care: ["先停在原地 1 分钟。", "闭眼待一会儿。", "找一个安静一点的位置。"],
};

const state = {
  tab: "capture",
  rangeKey: "30d",
  selectedDay: null,
  weather: null,
  settingsToast: "打开提醒后，可以设置时间和提示语。",
  reminderTimers: [],
  supabase: null,
  session: null,
  syncToast: "本地模式",
  shortcutHandled: false,
};

const nodes = {
  clock: document.querySelector("#clock"),
  moodGrid: document.querySelector("#moodGrid"),
  quickButtons: document.querySelector("#quickButtons"),
  particleLayer: document.querySelector("#particleLayer"),
  savedOverlay: document.querySelector("#savedOverlay"),
  savedEmoji: document.querySelector("#savedEmoji"),
  rangeKicker: document.querySelector("#rangeKicker"),
  rangeSummary: document.querySelector("#rangeSummary"),
  moodWeatherCard: document.querySelector("#moodWeatherCard"),
  weatherCard: document.querySelector("#weatherCard"),
  rangeTabs: document.querySelector("#rangeTabs"),
  statsGrid: document.querySelector("#statsGrid"),
  monthRow: document.querySelector("#monthRow"),
  weeks: document.querySelector("#weeks"),
  detailBox: document.querySelector("#detailBox"),
  recentTimeline: document.querySelector("#recentTimeline"),
  reminderEnabled: document.querySelector("#reminderEnabled"),
  reminderControls: document.querySelector("#reminderControls"),
  settingsToast: document.querySelector("#settingsToast"),
  shortcutUrls: document.querySelector("#shortcutUrls"),
  syncStatus: document.querySelector("#syncStatus"),
  syncUrl: document.querySelector("#syncUrl"),
  emailInput: document.querySelector("#emailInput"),
  loginButton: document.querySelector("#loginButton"),
  logoutButton: document.querySelector("#logoutButton"),
  syncNowButton: document.querySelector("#syncNowButton"),
};

function readRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function readSyncState() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_STATE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeSyncState(nextState) {
  localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(nextState));
}

function readSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function createRecord(mood, x, y) {
  const records = readRecords();
  records.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    timestamp: Date.now(),
    emoji: mood.emoji,
    tag: "",
    weather: state.weather?.status === "ready" ? state.weather.data : null,
  });
  writeRecords(records);
  pushRecordToCloud(records[records.length - 1]);
  navigator.vibrate?.(28);
  triggerParticles(x, y, mood.color);
  showSaved(mood.emoji);
  if (state.tab === "canvas") renderCanvas();
}

function findMoodByShortcut(value) {
  if (!value) return null;
  const normalized = decodeURIComponent(String(value)).trim().toLowerCase();
  return MOODS.find((mood) => {
    return mood.key === normalized || mood.label.toLowerCase() === normalized || mood.emoji === value;
  }) || null;
}

function handleShortcutRecord() {
  if (state.shortcutHandled) return false;

  const params = new URLSearchParams(window.location.search);
  const mood = findMoodByShortcut(params.get("mood"));
  if (!mood) return false;

  state.shortcutHandled = true;
  createRecord(mood, window.innerWidth / 2, Math.min(window.innerHeight * 0.42, 420));
  state.settingsToast = `已通过快捷入口记录：${mood.label}`;

  params.delete("mood");
  const rest = params.toString();
  const cleanUrl = `${window.location.origin}${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`;
  window.history.replaceState({}, document.title, cleanUrl);
  return true;
}

function updateClock() {
  nodes.clock.textContent = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });
  document.querySelector(`#${tab}Screen`).classList.add("active");
  if (tab === "canvas") renderCanvas();
  if (tab === "settings") renderSettings();
}

function renderMoodButtons() {
  nodes.moodGrid.innerHTML = "";
  nodes.quickButtons.innerHTML = "";

  MOODS.forEach((mood) => {
    const button = document.createElement("button");
    button.className = "mood-button";
    button.type = "button";
    button.innerHTML = `<span class="mood-emoji">${mood.emoji}</span><span>${mood.label}</span>`;
    button.addEventListener("click", (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      createRecord(mood, rect.left + rect.width / 2, rect.top + rect.height / 2);
    });
    nodes.moodGrid.appendChild(button);

    const quick = document.createElement("button");
    quick.className = "quick-button";
    quick.type = "button";
    quick.textContent = mood.emoji;
    quick.style.borderColor = mood.color;
    quick.addEventListener("click", (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      createRecord(mood, rect.left + rect.width / 2, rect.top + rect.height / 2);
    });
    nodes.quickButtons.appendChild(quick);
  });
}

function triggerParticles(x, y, color) {
  for (let index = 0; index < 38; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = 72 + Math.random() * 150;
    const size = 5 + Math.random() * 10;
    const particle = document.createElement("span");
    particle.className = "particle";
    particle.style.setProperty("--x", `${x}px`);
    particle.style.setProperty("--y", `${y}px`);
    particle.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    particle.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
    particle.style.setProperty("--size", `${size}px`);
    particle.style.setProperty("--color", color);
    nodes.particleLayer.appendChild(particle);
    particle.addEventListener("animationend", () => particle.remove(), { once: true });
  }
}

function showSaved(emoji) {
  nodes.savedEmoji.textContent = emoji;
  nodes.savedOverlay.classList.add("active");
  window.setTimeout(() => nodes.savedOverlay.classList.remove("active"), 500);
}

function renderCanvas() {
  const records = readRecords();
  const selectedRange = RANGE_OPTIONS.find((option) => option.key === state.rangeKey) || RANGE_OPTIONS[1];
  const filteredRecords = filterRecordsByRange(records, selectedRange.days);
  const dayMap = groupRecordsByDay(filteredRecords);
  const weeks = buildCalendarWeeks(selectedRange.days);
  const monthLabels = buildMonthLabels(weeks);
  const recentRecords = sortRecords(filteredRecords).slice(-5).reverse();

  nodes.rangeKicker.textContent = `过去 ${selectedRange.label}`;
  nodes.rangeSummary.textContent = formatRangeText(selectedRange.days);
  renderMoodWeather(analyzeMood(records));
  renderWeatherCard();
  renderRangeTabs();
  renderStats(filteredRecords);
  renderHeatmap(weeks, monthLabels, dayMap);
  renderDetail(dayMap, filteredRecords);
  renderTimeline(recentRecords);
}

function renderRangeTabs() {
  nodes.rangeTabs.innerHTML = "";
  RANGE_OPTIONS.forEach((option) => {
    const button = document.createElement("button");
    button.className = `range-tab${state.rangeKey === option.key ? " active" : ""}`;
    button.type = "button";
    button.textContent = option.label;
    button.addEventListener("click", () => {
      state.rangeKey = option.key;
      state.selectedDay = null;
      renderCanvas();
    });
    nodes.rangeTabs.appendChild(button);
  });
}

function renderStats(records) {
  nodes.statsGrid.innerHTML = "";
  MOODS.forEach((mood) => {
    const count = records.filter((record) => record.emoji === mood.emoji).length;
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `
      <div class="stat-emoji">${mood.emoji}</div>
      <div class="stat-count">${count}</div>
      <div class="stat-label">${mood.detail}</div>
    `;
    nodes.statsGrid.appendChild(card);
  });
}

function renderHeatmap(weeks, monthLabels, dayMap) {
  nodes.monthRow.innerHTML = '<span class="month-label"></span>';
  monthLabels.forEach((label) => {
    const node = document.createElement("span");
    node.className = "month-label";
    node.textContent = label;
    nodes.monthRow.appendChild(node);
  });

  nodes.weeks.innerHTML = "";
  weeks.forEach((week) => {
    const weekNode = document.createElement("div");
    weekNode.className = "week";
    week.forEach((day) => {
      const key = dayKey(day);
      const dayRecords = dayMap[key] || [];
      const record = latestRecord(dayRecords);
      const mood = MOODS.find((item) => item.emoji === record?.emoji);
      const cell = document.createElement("button");
      cell.className = "day-cell";
      if (key === dayKey(new Date())) cell.classList.add("today");
      if (state.selectedDay === key) cell.classList.add("selected");
      cell.type = "button";
      cell.style.backgroundColor = mood?.color || "#f4e8f0";
      cell.setAttribute("aria-label", record ? `${key} ${record.emoji}` : `${key} 未记录`);
      if (dayRecords.length > 1) {
        cell.innerHTML = `<span class="day-count">${dayRecords.length}</span>`;
      }
      cell.addEventListener("click", () => {
        state.selectedDay = key;
        renderCanvas();
      });
      weekNode.appendChild(cell);
    });
    nodes.weeks.appendChild(weekNode);
  });
}

function renderDetail(dayMap, filteredRecords) {
  if (!state.selectedDay) {
    nodes.detailBox.textContent = filteredRecords.length
      ? "点击一个格子查看当天所有记录"
      : "这个时间范围还没有记录。";
    return;
  }

  const dayRecords = sortRecords(dayMap[state.selectedDay] || []);
  if (!dayRecords.length) {
    nodes.detailBox.textContent = `${formatDayTitle(state.selectedDay)} 未记录`;
    return;
  }

  nodes.detailBox.innerHTML = "";
  dayRecords.forEach((record) => {
    nodes.detailBox.appendChild(createRecordRow(record, {
      text: `${formatDayTitle(state.selectedDay)}  ${record.emoji} ${formatRecordClock(record.timestamp)}  ${formatRecordWeather(record.weather)}`,
      compact: false,
    }));
  });
}

function renderTimeline(records) {
  nodes.recentTimeline.innerHTML = "";
  if (!records.length) {
    nodes.recentTimeline.innerHTML = '<p class="empty-text">还没有记录，先去按一个心情。</p>';
    return;
  }

  records.forEach((record) => {
    nodes.recentTimeline.appendChild(createRecordRow(record, {
      text: formatRecordTime(record.timestamp),
      compact: true,
    }));
  });
}

function createRecordRow(record, options) {
  const row = document.createElement("div");
  row.className = `record-row${options.compact ? " compact" : ""}`;

  const emoji = document.createElement("span");
  emoji.className = "timeline-emoji";
  emoji.textContent = record.emoji;

  const text = document.createElement("span");
  text.className = "timeline-text";
  text.textContent = options.text;

  const button = document.createElement("button");
  button.className = "delete-button";
  button.type = "button";
  button.textContent = "删除";
  button.addEventListener("click", () => deleteRecord(record.id));

  row.append(emoji, text, button);
  return row;
}

async function deleteRecord(recordId) {
  const confirmed = window.confirm("删除这条记录？");
  if (!confirmed) return;

  const nextRecords = readRecords().filter((record) => String(record.id) !== String(recordId));
  writeRecords(nextRecords);

  if (state.supabase && state.session) {
    const { error } = await state.supabase
      .from("mood_records")
      .delete()
      .eq("id", String(recordId));
    if (error) {
      state.syncToast = `云端删除失败：${error.message}`;
    } else {
      state.syncToast = "已删除并同步到云端。";
    }
  }

  renderCanvas();
  if (state.tab === "settings") renderSyncStatus();
}

function renderMoodWeather(analysis) {
  nodes.moodWeatherCard.className = `analysis-card ${analysis.level}`;
  nodes.moodWeatherCard.innerHTML = `
    <div class="card-head">
      <div class="card-emoji">${analysis.emoji}</div>
      <div>
        <div class="card-kicker">情绪天气</div>
        <div class="card-title">${analysis.title}</div>
      </div>
    </div>
    <div class="card-reason">${analysis.reason}</div>
    <div class="tip-box">${analysis.tip}</div>
  `;
}

function renderWeatherCard() {
  const content = formatWeatherCard(state.weather);
  nodes.weatherCard.innerHTML = `
    <div class="card-head">
      <div class="card-emoji">${content.emoji}</div>
      <div>
        <div class="card-kicker">当地天气</div>
        <div class="card-title">${content.title}</div>
      </div>
    </div>
    <div class="card-reason">${content.detail}</div>
  `;
}

function renderSettings() {
  const settings = readSettings();
  const syncState = readSyncState();
  nodes.reminderEnabled.checked = settings.reminderEnabled;
  nodes.settingsToast.textContent = state.settingsToast;
  nodes.emailInput.value = syncState.email || "";
  renderSyncStatus();
  nodes.reminderControls.innerHTML = "";

  if (!settings.reminderEnabled) {
    nodes.reminderControls.innerHTML = '<p class="empty-text">打开提醒后，可以设置时间和提示语。</p>';
  } else {
    settings.reminderTimes.forEach((time, index) => {
      const row = document.createElement("div");
      row.className = "time-row";
      row.innerHTML = `
        <span class="time-label">提醒 ${index + 1}</span>
        <div class="time-controls">
          <button class="step-button" data-action="hour-down">-</button>
          <span class="time-value">${formatTwoDigits(time.hour)}</span>
          <button class="step-button" data-action="hour-up">+</button>
          <span class="time-colon">:</span>
          <button class="step-button" data-action="minute-down">-</button>
          <span class="time-value">${formatTwoDigits(time.minute)}</span>
          <button class="step-button" data-action="minute-up">+</button>
        </div>
      `;
      row.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => {
          const action = button.dataset.action;
          const next = readSettings();
          const target = next.reminderTimes[index];
          if (action === "hour-down") target.hour = wrap(target.hour - 1, 24);
          if (action === "hour-up") target.hour = wrap(target.hour + 1, 24);
          if (action === "minute-down") target.minute = wrap(target.minute - 5, 60);
          if (action === "minute-up") target.minute = wrap(target.minute + 5, 60);
          writeSettings(next);
          if (next.reminderEnabled) scheduleBrowserReminders(next);
          renderSettings();
        });
      });
      nodes.reminderControls.appendChild(row);
    });

    const editor = document.createElement("div");
    editor.className = "message-editor";
    editor.innerHTML = `
      <label class="time-label" for="messageInput">提示语</label>
      <textarea id="messageInput" class="message-input" placeholder="写一句提醒自己的话"></textarea>
    `;
    const input = editor.querySelector("textarea");
    input.value = settings.reminderMessage;
    input.addEventListener("input", () => {
      const next = readSettings();
      next.reminderMessage = input.value;
      writeSettings(next);
    });
    nodes.reminderControls.appendChild(editor);
  }

  renderShortcutUrls();
}

function renderSyncStatus() {
  nodes.syncUrl.textContent = `登录回跳地址：${getCleanRedirectUrl()}`;

  const configured = isSupabaseConfigured();
  if (!configured) {
    nodes.syncStatus.textContent = "本地模式：请先填写 web/supabase-config.js 里的 Supabase URL 和 anon key。";
    return;
  }

  if (!state.session) {
    nodes.syncStatus.textContent = state.syncToast || "Supabase 已配置。输入邮箱发送登录链接后即可云同步。";
    return;
  }

  nodes.syncStatus.textContent = state.syncToast || `已登录：${state.session.user.email}`;
}

function renderShortcutUrls() {
  nodes.shortcutUrls.innerHTML = "";
  MOODS.forEach((mood) => {
    const item = document.createElement("div");
    item.className = "shortcut-url";
    item.textContent = `${window.location.origin}${window.location.pathname}?mood=${mood.key}`;
    nodes.shortcutUrls.appendChild(item);
  });
}

async function toggleNotifications() {
  const next = readSettings();
  next.reminderEnabled = !next.reminderEnabled;

  if (next.reminderEnabled) {
    if (!("Notification" in window)) {
      state.settingsToast = "当前浏览器不支持通知。";
      next.reminderEnabled = false;
    } else {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        state.settingsToast = "通知权限未开启。";
        next.reminderEnabled = false;
      } else {
        scheduleBrowserReminders(next);
        state.settingsToast = `已开启 ${next.reminderTimes.map(formatReminderTime).join(" 和 ")} 浏览器提醒`;
      }
    }
  } else {
    clearBrowserReminders();
    state.settingsToast = "已关闭浏览器提醒";
  }

  writeSettings(next);
  renderSettings();
}

function scheduleBrowserReminders(settings) {
  clearBrowserReminders();
  state.reminderTimers = settings.reminderTimes.map((time) => {
    return window.setTimeout(() => {
      sendReminder(settings.reminderMessage);
      scheduleBrowserReminders(readSettings());
    }, nextReminderDelay(time.hour, time.minute));
  });
}

function clearBrowserReminders() {
  state.reminderTimers.forEach((timer) => window.clearTimeout(timer));
  state.reminderTimers = [];
}

function sendReminder(message) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  new Notification("emomo", {
    body: message.trim() || DEFAULT_SETTINGS.reminderMessage,
  });
}

function isSupabaseConfigured() {
  const config = window.EMOMO_SUPABASE_CONFIG || {};
  return Boolean(config.url && config.anonKey);
}

async function initSupabase() {
  if (!isSupabaseConfigured()) {
    state.syncToast = "本地模式";
    if (state.tab === "settings") renderSyncStatus();
    return;
  }

  const config = window.EMOMO_SUPABASE_CONFIG;
  state.supabase = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  await completeAuthRedirect();

  const { data } = await state.supabase.auth.getSession();
  state.session = data.session;
  if (state.session) {
    state.syncToast = `已登录：${state.session.user.email}`;
    await syncWithCloud();
  } else {
    state.syncToast = "Supabase 已配置。输入邮箱发送登录链接后即可云同步。";
  }

  if (state.tab === "settings") renderSettings();
  handleShortcutRecord();

  state.supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    state.syncToast = session ? `已登录：${session.user.email}` : "未登录";
    if (session) await syncWithCloud();
    if (state.tab === "settings") renderSettings();
    if (state.tab === "canvas") renderCanvas();
  });
}

async function completeAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    if (!accessToken || !refreshToken) return;

    const { data, error } = await state.supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      state.syncToast = `登录回跳失败：${error.message}`;
      return;
    }

    state.session = data.session;
    state.syncToast = "登录成功，正在同步。";
    window.history.replaceState({}, document.title, getCleanRedirectUrl());
    return;
  }

  const { data, error } = await state.supabase.auth.exchangeCodeForSession(code);
  if (error) {
    state.syncToast = `登录回跳失败：${error.message}`;
    return;
  }

  state.session = data.session;
  state.syncToast = "登录成功，正在同步。";
  window.history.replaceState({}, document.title, getCleanRedirectUrl());
}

function getCleanRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

async function loginWithEmail() {
  if (!state.supabase) {
    state.syncToast = "Supabase 尚未配置。";
    renderSyncStatus();
    return;
  }

  const email = nodes.emailInput.value.trim();
  if (!email) {
    state.syncToast = "先输入邮箱。";
    renderSyncStatus();
    return;
  }

  writeSyncState({ ...readSyncState(), email });
  const { error } = await state.supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: getCleanRedirectUrl(),
    },
  });

  state.syncToast = error ? `登录链接发送失败：${error.message}` : "登录链接已发送，请去邮箱点击。";
  renderSyncStatus();
}

async function logout() {
  if (!state.supabase) return;
  await state.supabase.auth.signOut();
  state.session = null;
  state.syncToast = "已退出 Supabase。";
  renderSettings();
}

async function syncWithCloud() {
  if (!state.supabase || !state.session) {
    state.syncToast = "需要先登录 Supabase。";
    renderSyncStatus();
    return;
  }

  const localRecords = readRecords();
  const userId = state.session.user.id;
  const rows = localRecords.map((record) => ({
    id: String(record.id),
    user_id: userId,
    timestamp: record.timestamp,
    emoji: record.emoji,
    tag: record.tag || "",
    weather: record.weather || null,
  }));

  if (rows.length) {
    const { error: upsertError } = await state.supabase
      .from("mood_records")
      .upsert(rows, { onConflict: "id" });
    if (upsertError) {
      state.syncToast = `上传失败：${upsertError.message}`;
      renderSyncStatus();
      return;
    }
  }

  const { data, error: downloadError } = await state.supabase
    .from("mood_records")
    .select("id,timestamp,emoji,tag,weather")
    .order("timestamp", { ascending: true });

  if (downloadError) {
    state.syncToast = `下载失败：${downloadError.message}`;
    renderSyncStatus();
    return;
  }

  const merged = mergeRecords(localRecords, data || []);
  writeRecords(merged);
  state.syncToast = `已同步 ${merged.length} 条记录。`;
  if (state.tab === "canvas") renderCanvas();
  if (state.tab === "settings") renderSettings();
}

async function pushRecordToCloud(record) {
  if (!state.supabase || !state.session) return;

  const { error } = await state.supabase.from("mood_records").upsert(
    {
      id: String(record.id),
      user_id: state.session.user.id,
      timestamp: record.timestamp,
      emoji: record.emoji,
      tag: record.tag || "",
      weather: record.weather || null,
    },
    { onConflict: "id" },
  );

  if (error) {
    state.syncToast = `上传失败：${error.message}`;
    if (state.tab === "settings") renderSyncStatus();
  }
}

function mergeRecords(localRecords, remoteRecords) {
  const map = new Map();
  [...localRecords, ...remoteRecords].forEach((record) => {
    map.set(String(record.id), {
      id: String(record.id),
      timestamp: Number(record.timestamp),
      emoji: record.emoji,
      tag: record.tag || "",
      weather: record.weather || null,
    });
  });
  return [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
}

async function loadLocalWeather() {
  if (!navigator.geolocation) {
    state.weather = { status: "blocked" };
    renderWeatherCard();
    return;
  }

  state.weather = null;
  renderWeatherCard();

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        const { latitude, longitude } = position.coords;
        const url = [
          "https://api.open-meteo.com/v1/forecast",
          `?latitude=${latitude}`,
          `&longitude=${longitude}`,
          "&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
          "&timezone=auto",
        ].join("");
        const response = await fetch(url);
        if (!response.ok) throw new Error("weather request failed");
        const payload = await response.json();
        const current = payload.current;
        const condition = weatherConditionFromCode(current.weather_code);
        state.weather = {
          status: "ready",
          data: {
            temperature: Math.round(current.temperature_2m),
            humidity: Math.round(current.relative_humidity_2m),
            windSpeed: Math.round(current.wind_speed_10m),
            code: current.weather_code,
            condition: condition.label,
            emoji: condition.emoji,
            observedAt: Date.now(),
          },
        };
      } catch {
        state.weather = { status: "error" };
      }
      if (state.tab === "canvas") renderCanvas();
    },
    () => {
      state.weather = { status: "blocked" };
      if (state.tab === "canvas") renderCanvas();
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 30 * 60 * 1000 },
  );
}

function groupRecordsByDay(records) {
  return records.reduce((map, record) => {
    const key = dayKey(new Date(record.timestamp));
    map[key] = [...(map[key] || []), record];
    return map;
  }, {});
}

function latestRecord(records = []) {
  return records.reduce((latest, record) => {
    if (!latest || record.timestamp > latest.timestamp) return record;
    return latest;
  }, null);
}

function sortRecords(records = []) {
  return [...records].sort((a, b) => a.timestamp - b.timestamp);
}

function analyzeMood(records) {
  const sorted = sortRecords(records);
  if (!sorted.length) {
    return {
      level: "empty",
      emoji: "🌱",
      title: "等第一颗情绪种子",
      reason: "有记录之后，emomo 会观察最近的情绪节奏。",
      tip: "先轻轻按一个此刻的心情。",
    };
  }

  const recent = sorted.slice(-5);
  const lastThree = sorted.slice(-3);
  const weekRecords = filterRecordsByRange(sorted, 7);
  const todayRecords = sorted.filter((record) => dayKey(new Date(record.timestamp)) === dayKey(new Date()));
  const lowRecentCount = recent.filter((record) => scoreRecord(record) <= -2).length;
  const lowLastThreeCount = lastThree.filter((record) => scoreRecord(record) <= -2).length;
  const lowTodayCount = todayRecords.filter((record) => scoreRecord(record) <= -2).length;
  const weekAverage = averageScore(weekRecords);
  const quietDays = daysSince(sorted[sorted.length - 1].timestamp);

  if (lowLastThreeCount >= 3) return makeAnalysis("care", "最近有点低电量", "最近 3 次记录都偏低，值得温柔地关注一下。", sorted.length);
  if (lowRecentCount >= 4 || weekAverage <= -1.4) return makeAnalysis("care", "这段时间有点重", "最近的低落信号出现得比较密集。", sorted.length);
  if (lowTodayCount >= 3) return makeAnalysis("watch", "今天波动有点大", "今天偏低的记录出现了几次。", sorted.length);
  if (weekAverage <= -0.7 || lowRecentCount >= 2) return makeAnalysis("watch", "最近有点多云", "最近几次记录里，低电量情绪出现得稍多。", sorted.length);
  if (quietDays >= 3) {
    return {
      level: "empty",
      emoji: "🌤️",
      title: "有几天没记录了",
      reason: "暂时没有足够的新记录可以判断。",
      tip: "现在按一下就好。",
    };
  }
  return makeAnalysis("ok", "今天还算轻", "最近记录整体比较平稳。", sorted.length);
}

function makeAnalysis(level, title, reason, seed) {
  const icons = { ok: "☁️", watch: "🌥️", care: "🌧️" };
  return {
    level,
    emoji: icons[level],
    title,
    reason,
    tip: pickRegulationTip(level, seed),
  };
}

function scoreRecord(record) {
  const mood = MOODS.find((item) => item.emoji === record.emoji);
  const scores = { happy: 2, calm: 1, tired: -1, down: -2, sad: -2, angry: -2 };
  return scores[mood?.key] || 0;
}

function averageScore(records) {
  if (!records.length) return 0;
  return records.reduce((total, record) => total + scoreRecord(record), 0) / records.length;
}

function pickRegulationTip(level, seed) {
  const tips = REGULATION_TIPS[level] || REGULATION_TIPS.ok;
  return tips[seed % tips.length];
}

function daysSince(timestamp) {
  const then = startOfDay(new Date(timestamp));
  const now = startOfDay(new Date());
  return Math.floor((now.getTime() - then.getTime()) / (24 * 60 * 60 * 1000));
}

function filterRecordsByRange(records, days) {
  const end = new Date();
  const start = startOfDay(end);
  start.setDate(end.getDate() - days + 1);
  return records.filter((record) => record.timestamp >= start.getTime());
}

function buildCalendarWeeks(daysBack) {
  const today = startOfDay(new Date());
  const start = new Date(today);
  start.setDate(today.getDate() - daysBack + 1);
  while (start.getDay() !== 1) start.setDate(start.getDate() - 1);

  const weeks = [];
  const weekCount = Math.ceil((today.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  for (let week = 0; week < weekCount; week += 1) {
    const days = [];
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + week * 7 + day);
      days.push(date);
    }
    weeks.push(days);
  }
  return weeks;
}

function buildMonthLabels(weeks) {
  return weeks.map((week, index) => {
    const firstDay = week[0];
    const containsMonthStart = week.some((day) => day.getDate() <= 7);
    if (index === 0 || containsMonthStart) return `${firstDay.getMonth() + 1}月`;
    return "";
  });
}

function dayKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatRangeText(daysBack) {
  const end = startOfDay(new Date());
  const start = new Date(end);
  start.setDate(end.getDate() - daysBack + 1);
  return `${formatDateShort(start)} - ${formatDateShort(end)}`;
}

function formatDateShort(date) {
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function formatDayTitle(day) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function formatRecordTime(timestamp) {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRecordClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatWeatherCard(weather) {
  if (!weather) {
    return {
      emoji: "⏳",
      title: "天气读取中",
      detail: "拿到位置权限后，会把当时天气一起写进记录。",
    };
  }
  if (weather.status === "blocked") {
    return {
      emoji: "🛰️",
      title: "天气未开启",
      detail: "允许位置权限后，emomo 可以记录当地天气。",
    };
  }
  if (weather.status !== "ready") {
    return {
      emoji: "☁️",
      title: "天气暂时不可用",
      detail: "打卡不会受影响，稍后会自动再试。",
    };
  }
  const data = weather.data;
  return {
    emoji: data.emoji,
    title: `${data.temperature}°C · ${data.condition}`,
    detail: `湿度 ${data.humidity}% · 风速 ${data.windSpeed} km/h。打卡时会保存这份天气。`,
  };
}

function formatRecordWeather(weather) {
  if (!weather) return "未记录天气";
  return `${weather.emoji || "⏳"} ${weather.temperature}°C · ${weather.condition || "天气"}`;
}

function weatherConditionFromCode(code) {
  if (code === 0) return { label: "晴", emoji: "☀️" };
  if ([1, 2].includes(code)) return { label: "少云", emoji: "🌤️" };
  if (code === 3) return { label: "多云", emoji: "☁️" };
  if ([45, 48].includes(code)) return { label: "雾", emoji: "🌫️" };
  if ([51, 53, 55, 56, 57].includes(code)) return { label: "毛毛雨", emoji: "🌦️" };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: "雨", emoji: "🌧️" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: "雪", emoji: "❄️" };
  if ([95, 96, 99].includes(code)) return { label: "雷雨", emoji: "⛈️" };
  return { label: "天气", emoji: "⏳" };
}

function formatReminderTime(time) {
  return `${formatTwoDigits(time.hour)}:${formatTwoDigits(time.minute)}`;
}

function formatTwoDigits(value) {
  return String(value).padStart(2, "0");
}

function wrap(value, max) {
  return ((value % max) + max) % max;
}

function nextReminderDelay(hour, minute) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});
nodes.reminderEnabled.addEventListener("change", toggleNotifications);
nodes.loginButton.addEventListener("click", loginWithEmail);
nodes.logoutButton.addEventListener("click", logout);
nodes.syncNowButton.addEventListener("click", syncWithCloud);
nodes.emailInput.addEventListener("change", () => {
  writeSyncState({ ...readSyncState(), email: nodes.emailInput.value.trim() });
});

renderMoodButtons();
renderShortcutUrls();
updateClock();
window.setInterval(updateClock, 15_000);
loadLocalWeather();
initSupabase().then(() => {
  handleShortcutRecord();
});
