const STORAGE_KEY = "offer-index-state-v2";
const LEGACY_STORAGE_KEY = "offer-index-state-v1";
const STAGES = ["待投递", "待确认", "已投递", "有效回复", "面试", "拒绝", "搁置"];
const CHANNEL_LABELS = { platform: "招聘平台", official: "官方申请页", email: "招聘邮箱" };
const FREE_ANALYSIS_LIMIT = 10;
const AUTH_TOKEN_KEY = "offer-index-auth-token";
const PAID_PLAN_IDS = new Set(["sprint14", "pro30", "concierge30", "pro14"]);
const { apiFetch } = window.offerApi;
const DEFAULT_STATE = {
  version: 2,
  deviceId: crypto.randomUUID(),
  profile: {},
  careerAnalysis: null,
  personalityAnalysis: null,
  mbtiAnalysis: null,
  radar: { enabled: false, keywords: "", cities: "", frequency: "instant", sources: ["boss", "xiaohongshu", "douyin", "official"], notifications: false },
  opportunities: [],
  autoApply: { threshold: 80, dailyLimit: 10, excludedKeywords: "", resumeMode: "targeted" },
  applicationQueue: [],
  resumeRewrite: null,
  reviews: [],
  plan: { id: "free", reviewUsed: 0 },
  usage: { jobAnalyses: 0 },
  jobs: []
};

let state = loadState();
let currentAnalysis = null;
let pipelineFilter = "全部";
let config = { aiEnabled: false, model: null, localMode: true };
let authToken = localStorage.getItem(AUTH_TOKEN_KEY) || "";
let accountUser = null;
let authMode = "login";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.version === 2 && saved.profile && Array.isArray(saved.jobs)) {
      return {
        ...structuredClone(DEFAULT_STATE),
        ...saved,
        plan: { ...DEFAULT_STATE.plan, ...(saved.plan || {}) },
        radar: { ...DEFAULT_STATE.radar, ...(saved.radar || {}) },
        opportunities: Array.isArray(saved.opportunities) ? saved.opportunities : [],
        autoApply: { ...DEFAULT_STATE.autoApply, ...(saved.autoApply || {}) },
        applicationQueue: Array.isArray(saved.applicationQueue) ? saved.applicationQueue : [],
        reviews: Array.isArray(saved.reviews) ? saved.reviews : [],
        usage: { jobAnalyses: saved.usage?.jobAnalyses ?? saved.jobs.length }
      };
    }
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY));
    if (legacy && legacy.version === 1 && legacy.profile && Array.isArray(legacy.jobs)) {
      return {
        version: 2,
        deviceId: legacy.deviceId || crypto.randomUUID(),
        profile: {
          ...legacy.profile,
          extraMaterials: legacy.profile.extraMaterials || legacy.profile.portfolioSummary || ""
        },
        careerAnalysis: null,
        personalityAnalysis: null,
        mbtiAnalysis: null,
        radar: structuredClone(DEFAULT_STATE.radar),
        opportunities: [],
        autoApply: structuredClone(DEFAULT_STATE.autoApply),
        applicationQueue: [],
        resumeRewrite: null,
        reviews: [],
        plan: { id: "free", reviewUsed: 0 },
        usage: { jobAnalyses: legacy.jobs.length },
        jobs: legacy.jobs.map((job) => ({ channel: "platform", applicationTarget: "", ...job }))
      };
    }
  } catch {}
  return structuredClone(DEFAULT_STATE);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
}

function authHeaders(extra = {}) {
  return { ...extra, ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) };
}

async function track(type, data = {}) {
  try { await apiFetch("/api/events", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ type, data }) }); } catch {}
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

function navigate(view) {
  $$(".view").forEach((node) => node.classList.toggle("is-active", node.id === `view-${view}`));
  $$(".nav-item").forEach((node) => node.classList.toggle("is-active", node.dataset.view === view));
  document.body.classList.remove("menu-open");
  history.replaceState(null, "", `#${view}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function profileCompletion() {
  const keys = ["currentRole", "currentIndustry", "targetRoles", "targetIndustries", "city", "yearsExperience", "skills", "achievements", "resumeText"];
  return Math.round(keys.filter((key) => String(state.profile[key] || "").trim()).length / keys.length * 100);
}

function renderProfile() {
  const profile = state.profile;
  const targetRoleList = String(profile.targetRoles || "").split(/[，,、/\n]/).map((item) => item.trim()).filter(Boolean);
  $("#profile-completion").textContent = `${profileCompletion()}%`;
  $("#ticket-role").innerHTML = targetRoleList.length
    ? `${escapeHtml(targetRoleList[0])}${targetRoleList.length > 1 ? `<small>＋${targetRoleList.length - 1} 个备选</small>` : ""}`
    : "尚未填写目标岗位";
  $("#ticket-city").textContent = profile.city || "城市待定";
  $("#ticket-years").textContent = profile.yearsExperience !== undefined && profile.yearsExperience !== "" ? `${profile.yearsExperience} 年经验` : "经验待定";
  const form = $("#profile-form");
  [...form.elements].forEach((field) => {
    if (field.name && field.type !== "submit") field.value = profile[field.name] ?? "";
  });
}

function stats() {
  const jobs = state.jobs;
  const applied = jobs.filter((job) => ["已投递", "有效回复", "面试", "拒绝"].includes(job.stage)).length;
  const replies = jobs.filter((job) => ["有效回复", "面试"].includes(job.stage)).length;
  const interviews = jobs.filter((job) => job.stage === "面试").length;
  return [
    ["已分析岗位", jobs.length, "ALL ANALYZED"],
    ["已经投递", applied, "APPLICATIONS"],
    ["有效回复", replies, applied ? `${Math.round(replies / applied * 100)}% 回复率` : "WAITING FOR DATA"],
    ["面试邀约", interviews, applied ? `${Math.round(interviews / applied * 100)}% 邀约率` : "WAITING FOR DATA"]
  ];
}

function renderDashboard() {
  $("#stats-grid").innerHTML = stats().map(([label, value, foot]) => `
    <div class="stat"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong><span class="stat-foot">${foot}</span></div>
  `).join("");

  const recent = [...state.jobs].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 4);
  const list = $("#recent-jobs");
  if (!recent.length) {
    list.className = "job-list empty-state";
    list.textContent = "还没有岗位。先完成第一份分析。";
  } else {
    list.className = "job-list";
    list.innerHTML = recent.map((job) => `
      <div class="mini-job" data-job-id="${job.id}" tabindex="0">
        <div><strong>${escapeHtml(job.title || "未命名岗位")}</strong><small>${escapeHtml(job.company || "公司未填写")} · ${escapeHtml(job.stage)}</small></div>
        <span class="score-pill">${job.analysis?.score ?? "—"}</span>
        <small>${formatDate(job.updatedAt)}</small>
      </div>
    `).join("");
  }

  const incomplete = profileCompletion() < 80;
  const unappliedA = state.jobs.filter((job) => job.analysis?.recommendation === "A 优先投" && job.stage === "待投递");
  const title = $("#next-move-title");
  const text = $("#next-move-text");
  const button = $("#next-move-btn");
  if (incomplete) {
    title.textContent = "先完善求职档案";
    text.textContent = "完整的简历和目标偏好，会让岗位判断更可靠。";
    button.dataset.go = "profile";
  } else if (!state.careerAnalysis) {
    title.textContent = "先完成 AI 求职分析";
    text.textContent = "分析你的优势、缺口、适合方向和本轮投递策略。";
    button.dataset.go = "career";
  } else if (unappliedA.length) {
    title.textContent = `有 ${unappliedA.length} 个优先岗位待处理`;
    text.textContent = "建议先完成针对性材料，再决定是否提交。";
    button.dataset.go = "pipeline";
  } else {
    title.textContent = "分析下一个岗位";
    text.textContent = "持续积累结果，才能看见哪类岗位更容易获得回复。";
    button.dataset.go = "analyze";
  }
}

function renderPlan() {
  const paid = PAID_PLAN_IDS.has(state.plan?.id);
  const used = Number(state.usage?.jobAnalyses || 0);
  const usage = $("#plan-usage");
  usage.textContent = paid ? `${accountUser?.plan?.name || "付费方案"} · 合理使用规则` : `免费额度 ${Math.min(used, FREE_ANALYSIS_LIMIT)} / ${FREE_ANALYSIS_LIMIT}`;
  $("#sidebar-plan-name").textContent = accountUser?.plan?.name || (paid ? "求职付费方案" : "免费体验");
  $("#sidebar-plan-usage").textContent = paid ? "合理使用范围内可用" : `剩余 ${Math.max(0, FREE_ANALYSIS_LIMIT - used)} 个岗位分析`;
  renderService();
}

function renderService() {
  const paid = PAID_PLAN_IDS.has(state.plan?.id);
  const used = Number(state.usage?.jobAnalyses || 0);
  const reviews = Number(state.plan?.reviewUsed || 0);
  $("#service-plan-status").textContent = paid ? "14 天方案已开通" : "当前为免费体验";
  $("#service-analysis-usage").textContent = paid ? `已使用 ${used} 次 · 合理使用规则` : `已使用 ${Math.min(used, FREE_ANALYSIS_LIMIT)} / ${FREE_ANALYSIS_LIMIT}`;
  $("#review-one-status").textContent = paid ? (reviews >= 1 ? "已完成" : "待进行") : "开通后可用";
  $("#review-two-status").textContent = paid ? (reviews >= 2 ? "已完成" : "待进行") : "开通后可用";
  const serviceUpgrade = $("#service-upgrade-plan");
  serviceUpgrade.textContent = paid ? "服务已开通" : "开通 59 元方案";
  serviceUpgrade.disabled = paid;
}

function renderOutcomeReview() {
  const target = $("#review-result");
  const review = state.reviews?.[state.reviews.length - 1];
  if (!review) { target.classList.add("hidden"); target.innerHTML = ""; return; }
  const metric = (label, value, foot) => `<div class="review-metric"><span>${label}</span><strong>${value}</strong><small>${foot}</small></div>`;
  target.classList.remove("hidden");
  target.innerHTML = `
    <div class="review-result-head"><div><p class="eyebrow">RESULT REVIEW / ${String(state.reviews.length).padStart(2, "0")}</p><h2>本轮投递诊断</h2></div><span>${formatDate(review.createdAt)}</span></div>
    <div class="review-metrics">
      ${metric("真实投递", review.metrics.applied, "APPLICATIONS")}
      ${metric("有效回复率", `${review.metrics.replyRate}%`, `${review.metrics.replies} 次回复`)}
      ${metric("面试转化率", `${review.metrics.interviewRate}%`, `${review.metrics.interviews} 次面试`)}
    </div>
    <div class="result-block"><h4>问题判断</h4><ul>${review.diagnosis.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    <div class="result-block"><h4>下一轮动作</h4><ul>${review.actions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    ${review.comparison ? `<div class="review-comparison">相比上次：回复率 ${review.comparison.replyRateChange >= 0 ? "+" : ""}${review.comparison.replyRateChange} 个百分点 · 面试率 ${review.comparison.interviewRateChange >= 0 ? "+" : ""}${review.comparison.interviewRateChange} 个百分点</div>` : ""}
  `;
}

async function runOutcomeReview(index) {
  if (!PAID_PLAN_IDS.has(state.plan?.id)) return showToast("结果复盘包含在付费方案中，59 元方案可使用 2 次");
  if ((state.plan.reviewUsed || 0) >= 2 && state.plan.id === "sprint14") return showToast("14 天方案的两次复盘已经使用完毕");
  try {
    const previousReview = state.reviews?.[state.reviews.length - 1] || null;
    const response = await apiFetch("/api/outcome-review", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ jobs: state.jobs, previousReview }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "复盘失败");
    state.reviews ||= [];
    state.reviews.push({ ...payload.review, index });
    state.plan.reviewUsed = Number(state.plan.reviewUsed || 0) + 1;
    saveState();
    $("#review-result").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("投递结果复盘已生成");
    track("outcome_review_created", { index, applied: payload.review.metrics.applied });
  } catch (error) { showToast(error.message || "复盘失败"); }
}

function personalityMarkup(analysis) {
  const listBlock = (title, items) => `<div class="result-block"><h4>${title}</h4><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`;
  return `
    <div class="result-hero personality-result-hero">
      <div><div class="result-mode">WORK STYLE PROFILE</div><div class="personality-archetype">${escapeHtml(analysis.archetype)}</div></div>
      <p class="result-summary">${escapeHtml(analysis.summary)}</p>
    </div>
    <div class="result-block"><h4>六项工作偏好</h4><div class="dimension-list">${analysis.dimensions.map((item) => `<div class="dimension-row"><div><span>${escapeHtml(item.label)}</span><strong>${Math.round(item.score)}</strong></div><div class="dimension-track"><i style="width:${Math.max(0, Math.min(100, item.score))}%"></i></div></div>`).join("")}</div></div>
    ${listBlock("更适合你的工作环境", analysis.suitableEnvironments)}
    <div class="result-block"><h4>可优先探索的岗位方向</h4><div class="career-chips">${analysis.recommendedRoles.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div></div>
    ${listBlock("需要谨慎判断的环境", analysis.avoidEnvironments)}
    ${listBlock("面试时这样验证", analysis.interviewTips)}
    <div class="result-actions"><button class="primary-btn" data-go="analyze" type="button">用画像判断岗位</button><button class="outline-btn" id="rerun-personality" type="button">重新分析</button></div>
  `;
}

function renderPersonality() {
  const placeholder = $("#personality-placeholder");
  const result = $("#personality-result");
  if (!state.personalityAnalysis) {
    placeholder.classList.remove("hidden");
    result.classList.add("hidden");
    result.innerHTML = "";
    return;
  }
  placeholder.classList.add("hidden");
  result.classList.remove("hidden");
  result.innerHTML = personalityMarkup(state.personalityAnalysis);
}

function mbtiMarkup(analysis) {
  const listBlock = (title, items) => `<div class="result-block"><h4>${title}</h4><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`;
  return `
    <div class="result-hero mbti-result-hero">
      <div><div class="result-mode">YOUR MBTI CAREER PROFILE</div><div class="mbti-type">${escapeHtml(analysis.type)}</div><h3>${escapeHtml(analysis.title)}</h3></div>
      <p class="result-summary">${escapeHtml(analysis.summary)}</p>
    </div>
    <div class="result-block"><h4>四组偏好</h4><div class="mbti-dimensions">${analysis.dimensions.map((item) => `<div class="mbti-dimension"><div><span>${escapeHtml(item.left)}</span><strong>${escapeHtml(item.preference)}</strong><span>${escapeHtml(item.right)}</span></div><div class="mbti-track"><i style="left:${Math.max(0, Math.min(100, item.rightPercent))}%"></i></div><small>偏向 ${escapeHtml(item.preference)} · ${item.rightPercent}% 位于右侧</small></div>`).join("")}</div></div>
    <div class="result-block"><h4>适合优先探索的岗位族群</h4><div class="career-chips">${analysis.recommendedRoles.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div></div>
    ${listBlock("可能发挥优势的工作环境", analysis.suitableEnvironments)}
    ${listBlock("你可能自然展现的优势", analysis.strengths)}
    ${listBlock("使用结果前请注意", analysis.cautions)}
    <div class="result-actions"><button class="primary-btn" data-go="radar" type="button">用结果寻找机会</button><button class="outline-btn" id="rerun-mbti" type="button">重新测试</button></div>
  `;
}

function renderMbti() {
  const placeholder = $("#mbti-placeholder");
  const result = $("#mbti-result");
  if (!state.mbtiAnalysis) {
    placeholder.classList.remove("hidden");
    result.classList.add("hidden");
    result.innerHTML = "";
    return;
  }
  placeholder.classList.add("hidden");
  result.classList.remove("hidden");
  result.innerHTML = mbtiMarkup(state.mbtiAnalysis);
}

function updateMbtiProgress() {
  const completed = $$('#mbti-form select').filter((select) => select.value !== "").length;
  $("#mbti-progress-text").textContent = `已完成 ${completed} / 20`;
  $("#mbti-progress-bar").style.width = `${completed * 5}%`;
}

async function analyzeMbti(event) {
  event.preventDefault();
  const answers = Object.fromEntries(new FormData(event.currentTarget));
  const button = $("#mbti-analyze-btn");
  button.disabled = true;
  button.textContent = "正在生成职业画像…";
  try {
    const response = await apiFetch("/api/mbti-analysis", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ profile: state.profile, answers })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "MBTI 分析失败");
    state.mbtiAnalysis = payload.analysis;
    saveState();
    showToast(`你的 MBTI 类型是 ${payload.analysis.type}`);
  } catch (error) {
    showToast(error.message || "分析失败，请稍后重试");
  } finally {
    button.disabled = false;
    button.innerHTML = "查看我的 MBTI 职业画像 <span>→</span>";
  }
}

function combinedPersonalityAnalysis() {
  if (!state.personalityAnalysis && !state.mbtiAnalysis) return null;
  return {
    ...(state.personalityAnalysis || {}),
    archetype: state.personalityAnalysis?.archetype || state.mbtiAnalysis?.title || "职业偏好画像",
    recommendedRoles: [...new Set([...(state.personalityAnalysis?.recommendedRoles || []), ...(state.mbtiAnalysis?.recommendedRoles || [])])],
    suitableEnvironments: [...new Set([...(state.personalityAnalysis?.suitableEnvironments || []), ...(state.mbtiAnalysis?.suitableEnvironments || [])])],
    mbtiType: state.mbtiAnalysis?.type || null
  };
}

async function analyzePersonality(event) {
  event.preventDefault();
  const answers = Object.fromEntries(new FormData(event.currentTarget));
  const button = $("#personality-analyze-btn");
  button.disabled = true;
  button.textContent = "正在生成画像…";
  try {
    const response = await apiFetch("/api/personality-analysis", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ profile: state.profile, answers })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "工作风格分析失败");
    state.personalityAnalysis = payload.analysis;
    saveState();
    showToast("工作风格画像已生成");
  } catch (error) {
    showToast(error.message || "分析失败，请稍后重试");
  } finally {
    button.disabled = false;
    button.innerHTML = "生成工作风格画像 <span>→</span>";
  }
}

const RADAR_SOURCE_LABELS = { boss: "BOSS 直聘", xiaohongshu: "小红书", douyin: "抖音", official: "企业官网", greenhouse: "Greenhouse", lever: "Lever", other: "其他来源" };

function suggestedRadarKeywords() {
  const values = [state.profile.targetRoles, state.profile.targetIndustries, state.profile.skills]
    .flatMap((value) => String(value || "").split(/[，,、/\n]/))
    .concat(state.personalityAnalysis?.recommendedRoles || [], state.mbtiAnalysis?.recommendedRoles || [])
    .map((item) => item.trim()).filter(Boolean);
  return [...new Set(values)].slice(0, 14).join("，");
}

function opportunityMarkup(item) {
  const safeUrl = /^https?:\/\//i.test(item.url || "") ? item.url : "";
  return `<article class="opportunity-card">
    <div class="opportunity-card-top"><span>${escapeHtml(RADAR_SOURCE_LABELS[item.source] || "机会来源")}</span><strong>${Math.round(item.match?.score || 0)}</strong></div>
    <div><span class="opportunity-label">${escapeHtml(item.match?.label || "等待分析")}</span><h3>${escapeHtml(item.title || "未命名机会")}</h3><p>${escapeHtml(item.publisher || "发布者未填写")}</p></div>
    <ul>${(item.match?.reasons || []).slice(0, 3).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>
    <div class="opportunity-actions">${safeUrl ? `<a class="outline-btn" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">查看原始内容</a>` : ""}<button class="text-btn" data-delete-opportunity="${item.id}" type="button">删除</button></div>
  </article>`;
}

function renderRadar() {
  const form = $("#radar-form");
  if (!state.radar.keywords) state.radar.keywords = suggestedRadarKeywords();
  form.elements.keywords.value = state.radar.keywords || "";
  form.elements.cities.value = state.radar.cities || state.profile.city || "";
  form.elements.frequency.value = state.radar.frequency || "instant";
  $$('#radar-form input[name="sources"]').forEach((input) => { input.checked = (state.radar.sources || []).includes(input.value); });
  $("#radar-live-status").textContent = state.radar.enabled ? "监控已开启" : "尚未开启";
  $("#radar-live-status").classList.toggle("is-live", Boolean(state.radar.enabled));
  $("#enable-notifications").textContent = state.radar.notifications ? "通知已开启" : "开启浏览器通知";
  const opportunities = [...state.opportunities].sort((a, b) => (b.match?.score || 0) - (a.match?.score || 0));
  $("#radar-count").textContent = `${opportunities.length} 条`;
  $("#radar-opportunities").innerHTML = opportunities.length
    ? opportunities.map(opportunityMarkup).join("")
    : `<div class="radar-empty"><strong>还没有机会提醒</strong><p>先保存监控条件；看到社交平台招聘内容时，也可以粘贴到左侧立即判断。</p></div>`;
}

function safeBossUrl(value = "") {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "zhipin.com" || url.hostname.endsWith(".zhipin.com")) ? url.href : "";
  } catch { return ""; }
}

function queueItemMarkup(item) {
  const officialUrl = safeBossUrl(item.url);
  const statusLabels = { ready_for_confirmation: "等待官方页面确认", submitted: "已通过官方接口提交", confirmed: "用户已确认投递", failed: "提交失败" };
  return `<article class="application-queue-card" data-application-id="${item.id}">
    <div class="application-queue-top"><span>${escapeHtml(statusLabels[item.status] || item.status)}</span><strong>${Math.round(item.score || 0)}</strong></div>
    <div class="application-queue-main"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.company)}</p></div><span class="resume-version">${item.resumeMode === "targeted" ? "针对性简历" : "档案简历"}</span></div>
    <div class="application-greeting"><span>自动生成招呼语</span><p>${escapeHtml(item.greeting)}</p></div>
    <div class="application-queue-actions">
      <button class="text-btn" data-copy-application="${item.id}" type="button">复制材料</button>
      ${officialUrl ? `<a class="outline-btn" href="${escapeHtml(officialUrl)}" target="_blank" rel="noopener noreferrer">打开 BOSS 官方岗位</a>` : `<span class="missing-link">缺少可核验的 BOSS 链接</span>`}
      ${config.bossConnectorReady ? `<button class="primary-btn" data-submit-boss="${item.id}" type="button">确认并通过官方接口提交</button>` : `<button class="primary-btn" data-confirm-boss="${item.id}" type="button">我已在 BOSS 确认投递</button>`}
    </div>
  </article>`;
}

function renderAutoApply() {
  const form = $("#autoapply-form");
  form.elements.threshold.value = String(state.autoApply.threshold || 80);
  form.elements.dailyLimit.value = String(state.autoApply.dailyLimit || 10);
  form.elements.excludedKeywords.value = state.autoApply.excludedKeywords || state.profile.exclusions || "";
  form.elements.resumeMode.value = state.autoApply.resumeMode || "targeted";
  const bossItems = state.opportunities.filter((item) => item.source === "boss");
  const eligible = bossItems.filter((item) => Number(item.match?.score || 0) >= Number(state.autoApply.threshold || 80));
  const submitted = state.applicationQueue.filter((item) => ["submitted", "confirmed"].includes(item.status)).length;
  $("#boss-source-count").textContent = bossItems.length;
  $("#boss-ready-count").textContent = eligible.length;
  $("#boss-submitted-count").textContent = submitted;
  $("#boss-connector-title").textContent = config.bossConnectorReady ? "BOSS 官方授权接口已连接" : "安全确认模式";
  $("#boss-connector-copy").textContent = config.bossConnectorReady
    ? "自动提交仍要求用户明确授权；不会保存 BOSS 账号密码。"
    : "当前自动筛选、准备简历和招呼语；提交动作在 BOSS 官方页面由你确认。";
  $("#boss-connector-mode").textContent = config.bossConnectorReady ? "OFFICIAL API" : "NO ACCOUNT ACCESS";
  $("#boss-connector-banner").classList.toggle("is-connected", Boolean(config.bossConnectorReady));
  $("#boss-queue-status").textContent = state.applicationQueue.length ? `${state.applicationQueue.length} 个岗位` : "等待生成";
  $("#boss-application-queue").innerHTML = state.applicationQueue.length
    ? state.applicationQueue.map(queueItemMarkup).join("")
    : `<div class="queue-empty"><strong>还没有待投递岗位</strong><p>先在机会雷达中导入 BOSS 岗位，再按照你的分数、排除项和每日上限生成队列。</p><button class="outline-btn" data-go="radar" type="button">去导入 BOSS 岗位</button></div>`;
}

async function prepareBossQueue(event) {
  event.preventDefault();
  if (!state.profile.resumeText?.trim()) { showToast("请先完善个人档案和真实简历"); navigate("profile"); return; }
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const settings = { ...data, threshold: Number(data.threshold), dailyLimit: Number(data.dailyLimit), onlyBoss: true };
  const button = $("#prepare-boss-queue");
  button.disabled = true; button.textContent = "正在筛选并准备材料…";
  try {
    const response = await apiFetch("/api/application-queue/prepare", {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ profile: state.profile, opportunities: state.opportunities, settings, resumeRewrite: settings.resumeMode === "targeted" ? state.resumeRewrite : null })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "投递队列生成失败");
    state.autoApply = { ...state.autoApply, ...settings };
    const previous = new Map(state.applicationQueue.map((item) => [item.id, item]));
    state.applicationQueue = payload.queue.map((item) => previous.has(item.id) ? { ...item, status: previous.get(item.id).status } : item);
    saveState();
    showToast(state.applicationQueue.length ? `已准备 ${state.applicationQueue.length} 个高匹配岗位` : "暂时没有符合当前规则的 BOSS 岗位");
    track("boss_queue_prepared", { count: state.applicationQueue.length, threshold: settings.threshold });
  } catch (error) { showToast(error.message || "投递队列生成失败"); }
  finally { button.disabled = false; button.innerHTML = "准备所有合适岗位 <span>→</span>"; }
}

async function submitBossApplication(id) {
  const item = state.applicationQueue.find((application) => application.id === id);
  if (!item) return;
  if (!accountUser) { navigate("settings"); showToast("通过官方接口提交前请先登录账号"); return; }
  try {
    const response = await apiFetch("/api/connectors/boss/submit", {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ application: item, userConfirmed: true })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "官方接口提交失败");
    item.status = "submitted"; item.submittedAt = new Date().toISOString(); item.externalApplicationId = payload.applicationId || null;
    saveState(); showToast("已通过 BOSS 官方接口提交");
  } catch (error) { item.status = "failed"; saveState(); showToast(error.message || "官方接口提交失败"); }
}

function saveRadarSettings(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.radar = {
    ...state.radar,
    enabled: true,
    keywords: String(data.get("keywords") || "").trim(),
    cities: String(data.get("cities") || "").trim(),
    frequency: String(data.get("frequency") || "instant"),
    sources: data.getAll("sources")
  };
  saveState();
  showToast("机会监控条件已保存");
}

async function enableRadarNotifications() {
  if (!("Notification" in window)) return showToast("当前浏览器不支持系统通知");
  const permission = await Notification.requestPermission();
  state.radar.notifications = permission === "granted";
  saveState();
  if (permission === "granted") {
    new Notification("Offer 引力机会雷达", { body: "通知已开启。发现高匹配工作机会时会提醒你。" });
    showToast("浏览器通知已开启");
  } else showToast("通知未获授权，可继续在机会雷达中查看结果");
}

function notifyOpportunity(item) {
  if (!state.radar.notifications || !("Notification" in window) || Notification.permission !== "granted") return;
  if ((item.match?.score || 0) < 72) return;
  new Notification(`发现高匹配机会：${item.title}`, { body: `${RADAR_SOURCE_LABELS[item.source] || "新来源"} · 匹配 ${Math.round(item.match.score)} 分` });
}

async function addOpportunity(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const opportunity = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = "正在匹配…";
  try {
    const response = await apiFetch("/api/match-opportunity", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ profile: state.profile, personalityAnalysis: combinedPersonalityAnalysis(), opportunity })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "机会分析失败");
    const item = { ...opportunity, id: crypto.randomUUID(), match: payload.match, createdAt: new Date().toISOString() };
    state.opportunities.unshift(item);
    saveState();
    notifyOpportunity(item);
    form.reset();
    showToast(`${payload.match.label} · ${Math.round(payload.match.score)} 分`);
  } catch (error) {
    showToast(error.message || "机会分析失败");
  } finally {
    button.disabled = false;
    button.textContent = "分析并加入雷达";
  }
}

async function matchCollectedOpportunity(opportunity) {
  const response = await apiFetch("/api/match-opportunity", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile: state.profile, personalityAnalysis: combinedPersonalityAnalysis(), opportunity: { ...opportunity, publisher: opportunity.company || opportunity.publisher } })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "岗位匹配失败");
  return { ...opportunity, publisher: opportunity.company || opportunity.publisher, id: crypto.randomUUID(), match: payload.match, createdAt: new Date().toISOString() };
}

async function collectSource(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#collect-source-btn");
  const status = $("#collector-status");
  const source = Object.fromEntries(new FormData(form));
  button.disabled = true;
  button.textContent = "正在同步…";
  status.className = "collector-status is-working";
  status.textContent = "正在读取公开信息、过滤过期岗位并去重。";
  try {
    const response = await apiFetch("/api/opportunities/collect", {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ ...source, limit: 30, save: Boolean(accountUser) })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "公开岗位同步失败");
    const existing = new Set(state.opportunities.map((item) => item.fingerprint || item.url).filter(Boolean));
    const fresh = payload.opportunities.filter((item) => !existing.has(item.fingerprint || item.url));
    const matched = await Promise.all(fresh.map(matchCollectedOpportunity));
    state.opportunities.unshift(...matched);
    saveState();
    matched.forEach(notifyOpportunity);
    status.className = "collector-status is-success";
    status.textContent = `同步完成：读取 ${payload.opportunities.length} 条，新增 ${matched.length} 条，重复或过期 ${payload.opportunities.length - matched.length} 条。`;
    showToast(`已新增 ${matched.length} 条公开岗位`);
    track("public_source_collected", { type: source.type, count: matched.length });
  } catch (error) {
    status.className = "collector-status";
    status.textContent = error.message || "同步失败，请检查公开来源地址";
    showToast(status.textContent);
  } finally {
    button.disabled = false;
    button.textContent = "同步公开岗位";
  }
}

async function handleResumeFile(file) {
  if (!file) return;
  if (file.size > 8_000_000) return showToast("简历文件不能超过 8MB");
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  try {
    showToast("正在解析简历文件…");
    const response = await apiFetch("/api/resume/extract", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, mimeType: file.type, base64 })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "简历解析失败");
    $("#profile-form").elements.resumeText.value = payload.resume.text;
    showToast("简历文本已读取，请检查后保存档案");
    track("resume_file_extracted", { mode: payload.resume.mode, extension: file.name.split(".").pop() });
  } catch (error) { showToast(error.message || "简历解析失败"); }
}

function renderCommercial() {
  $("#account-shortcut").textContent = accountUser ? (accountUser.name || accountUser.email) : "登录／云同步";
  $("#account-logged-out").classList.toggle("hidden", Boolean(accountUser));
  $("#account-logged-in").classList.toggle("hidden", !accountUser);
  if (accountUser) {
    $("#account-name").textContent = accountUser.name || "已登录用户";
    $("#account-email").textContent = accountUser.email;
    $("#account-plan").textContent = accountUser.plan?.name || "免费体验";
  }
  const integrations = [
    { name: "AI 深度分析", ready: config.aiEnabled, pending: "需创建项目密钥", note: "密钥只保存在服务端，不能放进网页代码。", href: "https://platform.openai.com/api-keys", action: "OpenAI 官方入口" },
    { name: "账号与云端数据", ready: true, note: "注册、登录、云端状态与数据删除已可用。" },
    { name: "公开招聘源采集", ready: true, note: "支持企业官网 JobPosting、Greenhouse 与 Lever 公开职位。" },
    { name: "Web 离线通知基础", ready: "serviceWorker" in navigator, pending: "当前浏览器不支持", note: "离线外壳已接入；跨设备推送仍需正式推送服务。" },
    { name: "微信／支付宝支付", ready: config.paymentReady, pending: "需商户主体与审核", note: "个人收款码不能代替产品支付接口。", href: "https://open.alipay.com/module/webApp", action: "支付宝开放平台" },
    { name: "PDF／Word 简历解析", ready: config.resumeParserReady, note: "TXT、文本型 PDF、DOCX 已在本地服务端解析；扫描件需 OCR。" },
    { name: "BOSS 官方投递接口", ready: config.bossConnectorReady, pending: "需平台书面合作", note: "目前没有可直接自助申请的求职者批量投递接口。", href: "https://www.zhipin.com/aboutContact", action: "BOSS 官方联系" },
    { name: "小红书／抖音开放接口", ready: false, pending: "需企业开发者审核", note: "现有公开能力不等于全站招聘内容搜索权限。", href: "https://developer.open-douyin.com/m/docs/resource/zh-CN/developer/join/join-into-developer-platform", action: "抖音入驻说明" }
  ];
  $("#integration-list").innerHTML = integrations.map((item) => `<div class="integration-item integration-item-detailed">
    <div><span>${escapeHtml(item.name)}</span><small>${escapeHtml(item.note || "")}</small>${item.href ? `<a href="${escapeHtml(item.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.action)} →</a>` : ""}</div>
    <strong class="${item.ready ? "ready" : "pending"}">${item.ready ? "已接入" : escapeHtml(item.pending || "待配置／授权")}</strong>
  </div>`).join("");
}

async function refreshAccount() {
  if (!authToken) { accountUser = null; renderCommercial(); return; }
  try {
    const response = await apiFetch("/api/auth/me", { headers: authHeaders() });
    if (!response.ok) throw new Error("登录已失效");
    accountUser = (await response.json()).user;
    state.plan = { ...state.plan, id: accountUser.plan?.id || "free" };
    const notificationsResponse = await apiFetch("/api/notifications", { headers: authHeaders() });
    if (notificationsResponse.ok) {
      const notificationPayload = await notificationsResponse.json();
      const existing = new Set(state.opportunities.map((item) => item.fingerprint || item.url).filter(Boolean));
      const fromBackground = (notificationPayload.notifications || []).map((item) => item.opportunity).filter(Boolean).filter((item) => !existing.has(item.fingerprint || item.url));
      state.opportunities.unshift(...fromBackground.map((item) => ({ ...item, id: item.id || crypto.randomUUID(), createdAt: item.createdAt || new Date().toISOString() })));
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    authToken = ""; accountUser = null; localStorage.removeItem(AUTH_TOKEN_KEY);
  }
  renderAll();
}

async function submitAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form));
  const button = $("#account-submit");
  button.disabled = true;
  button.textContent = authMode === "login" ? "正在登录…" : "正在创建账号…";
  try {
    const response = await apiFetch(`/api/auth/${authMode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "账号操作失败");
    authToken = payload.token;
    localStorage.setItem(AUTH_TOKEN_KEY, authToken);
    accountUser = payload.user;
    state.plan = { ...state.plan, id: accountUser.plan?.id || "free" };
    saveState();
    showToast(authMode === "login" ? "登录成功" : "账号创建成功");
  } catch (error) { showToast(error.message || "账号操作失败"); }
  finally { button.disabled = false; button.textContent = authMode === "login" ? "登录并同步" : "创建账号"; }
}

async function uploadCloud() {
  try {
    const response = await apiFetch("/api/cloud/state", { method: "PUT", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ state }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "同步失败");
    showToast("当前数据已安全同步到账号");
    track("cloud_state_uploaded");
  } catch (error) { showToast(error.message || "同步失败"); }
}

async function downloadCloud() {
  try {
    const response = await apiFetch("/api/cloud/state", { headers: authHeaders() });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "读取云端数据失败");
    if (!payload.cloud?.state) return showToast("账号中还没有云端备份");
    if (!confirm("确定用云端数据替换当前浏览器数据吗？")) return;
    const backup = new File([JSON.stringify(payload.cloud.state)], "cloud.json", { type: "application/json" });
    await importData(backup);
    track("cloud_state_restored");
  } catch (error) { showToast(error.message || "读取云端数据失败"); }
}

async function checkout(planId) {
  if (!accountUser) {
    navigate("settings");
    showToast("请先创建账号或登录，再开通套餐");
    return;
  }
  try {
    const response = await apiFetch("/api/billing/checkout", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ planId }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.next || payload.error || "暂时无法发起支付");
    if (payload.checkoutUrl) {
      window.location.assign(payload.checkoutUrl);
      return;
    }
    accountUser = payload.user;
    state.plan = { ...state.plan, id: accountUser.plan.id };
    saveState();
    showToast(payload.demo ? "测试支付完成，套餐已激活" : "套餐已激活");
  } catch (error) { showToast(error.message || "支付通道尚未配置"); }
}

function resumeRewriteMarkup(rewrite) {
  const listBlock = (title, items) => `<div class="result-block"><h4>${title}</h4><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`;
  return `
    <div class="result-hero resume-result-hero">
      <div><div class="result-mode">${rewrite.mode === "ai" ? `AI / ${escapeHtml(rewrite.model || "")}` : "LOCAL RESUME MODE"}</div><div class="resume-headline">${escapeHtml(rewrite.headline)}</div></div>
      <p class="result-summary">${escapeHtml(rewrite.professionalSummary)}</p>
    </div>
    <div class="result-block"><h4>改写后的简历</h4><pre class="rewritten-resume">${escapeHtml(rewrite.rewrittenResume)}</pre></div>
    ${listBlock("本次调整", rewrite.changeNotes)}
    ${listBlock("需要你确认或补充", rewrite.missingEvidence)}
    <div class="result-actions"><button class="primary-btn" id="copy-rewritten-resume" type="button">复制新版简历</button><button class="outline-btn" id="save-rewritten-resume" type="button">保存到个人档案</button></div>
  `;
}

function renderResumeRewrite() {
  const placeholder = $("#resume-placeholder");
  const result = $("#resume-result");
  const roleInput = $("#resume-form").elements.targetRole;
  if (!roleInput.value && state.profile.targetRoles) roleInput.value = String(state.profile.targetRoles).split(/[，,、/\n]/)[0].trim();
  if (!state.resumeRewrite) {
    placeholder.classList.remove("hidden");
    result.classList.add("hidden");
    result.innerHTML = "";
    return;
  }
  placeholder.classList.add("hidden");
  result.classList.remove("hidden");
  result.innerHTML = resumeRewriteMarkup(state.resumeRewrite);
}

async function rewriteResume(event) {
  event.preventDefault();
  if (!state.profile.resumeText?.trim()) {
    showToast("请先填写并保存个人档案中的简历文本");
    navigate("profile");
    return;
  }
  const target = Object.fromEntries(new FormData(event.currentTarget));
  const button = $("#rewrite-resume-btn");
  const hint = $("#resume-hint");
  button.disabled = true;
  button.textContent = "正在重组简历…";
  hint.textContent = "正在核对真实经历与目标岗位";
  try {
    const response = await apiFetch("/api/rewrite-resume", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ profile: state.profile, target, deviceId: state.deviceId })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "简历改写失败");
    state.resumeRewrite = payload.rewrite;
    saveState();
    if (payload.warning) showToast(payload.warning); else showToast("简历改写已完成");
  } catch (error) {
    showToast(error.message || "简历改写失败，请稍后重试");
  } finally {
    button.disabled = false;
    button.innerHTML = "AI 改写简历 <span>→</span>";
    hint.textContent = "所有改写内容都需要你人工核对";
  }
}

function careerResultMarkup(analysis) {
  const chips = (items) => `<div class="career-chips">${items.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`;
  const block = (title, items) => `<div class="result-block"><h4>${title}</h4><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`;
  return `
    <div class="result-hero career-result-hero">
      <div class="result-score-row"><div class="result-score">${Math.round(analysis.readinessScore)}</div><div><div class="result-grade">${escapeHtml(analysis.grade)}</div><div class="result-mode">${analysis.mode === "ai" ? `AI / ${escapeHtml(analysis.model || "")}` : "LOCAL CAREER MODE"}</div></div></div>
      <p class="result-summary">${escapeHtml(analysis.summary)}</p>
    </div>
    ${block("你的优势", analysis.advantages)}
    ${block("当前缺口", analysis.gaps)}
    <div class="result-block"><h4>建议岗位</h4>${chips(analysis.roleSuggestions)}</div>
    <div class="result-block"><h4>建议行业</h4>${chips(analysis.industrySuggestions)}</div>
    ${block("本轮求职策略", analysis.strategy)}
    ${block("下一步行动", analysis.nextSteps)}
    <div class="result-actions"><button class="primary-btn" data-go="analyze" type="button">开始匹配岗位</button><button class="outline-btn" id="rerun-career" type="button">重新分析</button></div>
  `;
}

function renderCareer() {
  const placeholder = $("#career-placeholder");
  const result = $("#career-result");
  if (!state.careerAnalysis) {
    placeholder.classList.remove("hidden");
    result.classList.add("hidden");
    result.innerHTML = "";
    return;
  }
  placeholder.classList.add("hidden");
  result.classList.remove("hidden");
  result.innerHTML = careerResultMarkup(state.careerAnalysis);
}

async function analyzeCareer() {
  if (!state.profile.resumeText?.trim()) {
    showToast("请先填写并保存个人档案");
    navigate("profile");
    return;
  }
  const button = $("#career-analyze-btn");
  button.disabled = true;
  button.textContent = "正在分析你的情况…";
  try {
    const response = await apiFetch("/api/career-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: state.profile, deviceId: state.deviceId })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "求职分析失败");
    state.careerAnalysis = payload.analysis;
    saveState();
    if (payload.warning) showToast(payload.warning); else showToast("个人求职分析已完成");
  } catch (error) {
    showToast(error.message || "求职分析失败，请稍后重试");
  } finally {
    button.disabled = false;
    button.innerHTML = "开始 AI 分析 <span>→</span>";
  }
}

function verdictClass(verdict) {
  if (verdict === "满足") return "good";
  if (["有风险", "不满足"].includes(verdict)) return "risk";
  return "";
}

function resultMarkup(analysis) {
  return `
    <div class="result-hero">
      <div class="result-score-row"><div class="result-score">${Math.round(analysis.score)}</div><div><div class="result-grade">${escapeHtml(analysis.recommendation)}</div><div class="result-mode">${analysis.mode === "ai" ? `AI / ${escapeHtml(analysis.model || "")}` : "LOCAL EVIDENCE MODE"}</div></div></div>
      <p class="result-summary">${escapeHtml(analysis.summary)}</p>
    </div>
    <div class="result-block"><h4>硬条件核对</h4><div class="condition-list">${analysis.hardConditions.map((item) => `
      <div class="condition"><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.requirement)} / 你：${escapeHtml(item.candidate)}</span><span class="verdict ${verdictClass(item.verdict)}">${escapeHtml(item.verdict)}</span></div>
    `).join("")}</div></div>
    <div class="result-block"><h4>匹配证据</h4><ul>${analysis.strengths.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    <div class="result-block"><h4>缺口与风险</h4><ul>${analysis.gaps.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    <div class="result-block"><h4>材料调整</h4><ul>${analysis.resumeSuggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    <div class="result-block"><h4>建议招呼语</h4><div class="greeting-box">${escapeHtml(analysis.greeting)}</div><button class="copy-btn" data-copy="greeting" type="button">复制招呼语</button></div>
    <div class="result-actions"><button class="primary-btn" id="save-job" type="button">加入投递看板</button><button class="outline-btn" id="reset-analysis" type="button">分析另一个</button></div>
  `;
}

function showAnalysis(analysis) {
  currentAnalysis = analysis;
  $("#analysis-placeholder").classList.add("hidden");
  const result = $("#analysis-result");
  result.classList.remove("hidden");
  result.innerHTML = resultMarkup(analysis);
}

function resetAnalysis() {
  currentAnalysis = null;
  $("#job-form").reset();
  $("#analysis-result").classList.add("hidden");
  $("#analysis-placeholder").classList.remove("hidden");
}

function saveCurrentJob() {
  if (!currentAnalysis) return;
  const formData = Object.fromEntries(new FormData($("#job-form")));
  const existingId = $("#job-form").dataset.editingId;
  const now = new Date().toISOString();
  const job = {
    id: existingId || crypto.randomUUID(),
    company: formData.company?.trim(),
    industry: formData.industry?.trim(),
    title: formData.title?.trim(),
    location: formData.location?.trim(),
    salary: formData.salary?.trim(),
    channel: formData.channel || "platform",
    applicationTarget: formData.applicationTarget?.trim(),
    description: formData.description?.trim(),
    analysis: currentAnalysis,
    stage: "待投递",
    createdAt: now,
    updatedAt: now
  };
  const index = state.jobs.findIndex((item) => item.id === job.id);
  if (index >= 0) job.createdAt = state.jobs[index].createdAt;
  if (index >= 0) state.jobs[index] = job; else state.jobs.unshift(job);
  delete $("#job-form").dataset.editingId;
  saveState();
  showToast("已加入投递看板");
  navigate("pipeline");
}

function renderPipeline() {
  const filters = ["全部", ...STAGES];
  $("#pipeline-filters").innerHTML = filters.map((filter) => `<button class="filter-btn ${filter === pipelineFilter ? "is-active" : ""}" data-filter="${filter}" type="button">${filter}</button>`).join("");
  const jobs = pipelineFilter === "全部" ? state.jobs : state.jobs.filter((job) => job.stage === pipelineFilter);
  $("#pipeline-body").innerHTML = jobs.length ? jobs.map((job) => `
    <tr data-job-id="${job.id}">
      <td><strong>${escapeHtml(job.title)}</strong><small>${escapeHtml(job.company || "公司未填写")} · ${escapeHtml(job.location || "地点未填写")}</small></td>
      <td>${escapeHtml(job.analysis?.recommendation || "—")}</td>
      <td><span class="score-pill">${job.analysis?.score ?? "—"}</span></td>
      <td>${escapeHtml(CHANNEL_LABELS[job.channel] || "招聘平台")}</td>
      <td><select class="stage-select" aria-label="更新投递阶段">${STAGES.map((stage) => `<option ${stage === job.stage ? "selected" : ""}>${stage}</option>`).join("")}</select></td>
      <td>${formatDate(job.updatedAt)}</td>
      <td><button class="row-action" data-open-job="${job.id}" type="button" aria-label="查看岗位">→</button></td>
    </tr>
  `).join("") : `<tr><td colspan="7" class="table-empty">这个阶段还没有岗位记录。</td></tr>`;
}

function openJob(id) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return;
  $("#job-dialog-content").innerHTML = `
    <div class="dialog-body">
      <p class="eyebrow">${escapeHtml(job.analysis?.recommendation || "JOB")}</p>
      <h2>${escapeHtml(job.title)}</h2>
      <p class="dialog-meta">${escapeHtml(job.company || "公司未填写")} · ${escapeHtml(job.location || "地点未填写")} · ${escapeHtml(job.salary || "薪资未填写")}</p>
      <p>${escapeHtml(job.analysis?.summary || "")}</p>
      <div class="greeting-box">${escapeHtml(job.analysis?.greeting || "暂无招呼语")}</div>
      <p class="application-note">投递方式：${escapeHtml(CHANNEL_LABELS[job.channel] || "招聘平台")}。${job.applicationTarget ? `目标：${escapeHtml(job.applicationTarget)}` : "尚未填写岗位链接或招聘邮箱。"}</p>
      <div class="dialog-actions">
        <button class="primary-btn" data-prepare-application="${job.id}" type="button">准备并前往投递</button>
        <button class="outline-btn" data-dialog-copy="${job.id}" type="button">复制招呼语</button>
        <button class="outline-btn" data-dialog-edit="${job.id}" type="button">重新分析</button>
        <button class="danger-btn" data-dialog-delete="${job.id}" type="button">删除记录</button>
      </div>
    </div>`;
  $("#job-dialog").showModal();
}

async function prepareApplication(id) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return;
  const target = String(job.applicationTarget || "").trim();
  const greeting = job.analysis?.greeting || "";
  if (greeting) await navigator.clipboard.writeText(greeting);

  if (!target) {
    showToast("材料已准备，请先为该岗位补充申请链接或招聘邮箱");
    return;
  }
  if (job.channel === "email") {
    const email = target.replace(/^mailto:/i, "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast("招聘邮箱格式不正确");
    location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`应聘${job.title}｜${state.profile.name || "候选人"}`)}&body=${encodeURIComponent(`${greeting}\n\n简历请见附件。发送前请再次检查内容并添加简历附件。`)}`;
  } else {
    let url;
    try { url = new URL(target); } catch { return showToast("岗位链接格式不正确"); }
    if (!["http:", "https:"].includes(url.protocol)) return showToast("只支持安全的 http/https 岗位链接");
    window.open(url.href, "_blank", "noopener,noreferrer");
  }
  job.stage = "待确认";
  job.updatedAt = new Date().toISOString();
  saveState();
  $("#job-dialog").close();
  showToast("招呼语已复制，请在目标页面确认材料并完成发送");
}

function editJob(id) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return;
  const form = $("#job-form");
  ["company", "industry", "title", "location", "salary", "channel", "applicationTarget", "description"].forEach((key) => {
    if (form.elements[key]) form.elements[key].value = job[key] || (key === "channel" ? "platform" : "");
  });
  form.elements.confirmTruth.checked = true;
  form.dataset.editingId = id;
  showAnalysis(job.analysis);
  $("#job-dialog").close();
  navigate("analyze");
}

function deleteJob(id) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job || !confirm(`确定删除“${job.title}”吗？`)) return;
  state.jobs = state.jobs.filter((item) => item.id !== id);
  saveState();
  $("#job-dialog").close();
  showToast("岗位记录已删除");
}

async function analyzeJob(event) {
  event.preventDefault();
  if (!state.profile.resumeText?.trim()) {
    showToast("请先填写并保存求职档案");
    navigate("profile");
    return;
  }
  if (!PAID_PLAN_IDS.has(state.plan?.id) && Number(state.usage?.jobAnalyses || 0) >= FREE_ANALYSIS_LIMIT) {
    showToast("10 个免费岗位已用完，可选择求职冲刺或专业方案继续分析");
    navigate("dashboard");
    setTimeout(() => $("#plans-title")?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
    return;
  }
  const form = event.currentTarget;
  const job = Object.fromEntries(new FormData(form));
  delete job.confirmTruth;
  const button = $("#analyze-btn");
  const hint = $("#analysis-hint");
  button.disabled = true;
  button.textContent = "正在分析…";
  hint.textContent = config.aiEnabled ? "正在核对材料证据" : "正在运行本地匹配规则";
  try {
    const response = await apiFetch("/api/analyze", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ profile: state.profile, job, deviceId: state.deviceId })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "分析失败");
    showAnalysis(payload.analysis);
    state.usage = { ...state.usage, jobAnalyses: Number(state.usage?.jobAnalyses || 0) + 1 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderPlan();
    if (payload.warning) showToast(payload.warning);
  } catch (error) {
    showToast(error.message || "分析失败，请稍后重试");
  } finally {
    button.disabled = false;
    button.innerHTML = "分析岗位 <span>→</span>";
    hint.textContent = "通常需要几秒钟";
  }
}

function renderMode() {
  const label = config.aiEnabled ? `AI 分析 · ${config.model}` : "本地证据分析";
  $("#mode-label").textContent = label;
  $("#settings-mode").textContent = label;
  $("#settings-mode-detail").textContent = config.aiEnabled
    ? "AI Key 只存在服务端环境中。分析时会发送必要的简历与职位文本，程序不会存储招聘平台密码。"
    : "无需联网和 API Key，可立即使用。配置服务端 OPENAI_API_KEY 后会自动启用更深入的语义分析。";
}

function renderAll() {
  renderProfile();
  renderDashboard();
  renderPlan();
  renderCareer();
  renderPersonality();
  renderMbti();
  renderRadar();
  renderAutoApply();
  renderResumeRewrite();
  renderPipeline();
  renderOutcomeReview();
  renderMode();
  renderCommercial();
}

async function exportData() {
  const blob = new Blob([JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `offer-yinli-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("备份已下载");
}

async function importData(file) {
  try {
    const imported = JSON.parse(await file.text());
    if (![1, 2].includes(imported.version) || !imported.profile || !Array.isArray(imported.jobs)) throw new Error("不是有效的 Offer 引力备份");
    state = {
      version: 2,
      deviceId: imported.deviceId || crypto.randomUUID(),
      profile: { ...imported.profile, extraMaterials: imported.profile.extraMaterials || imported.profile.portfolioSummary || "" },
      careerAnalysis: imported.careerAnalysis || null,
      personalityAnalysis: imported.personalityAnalysis || null,
      mbtiAnalysis: imported.mbtiAnalysis || null,
      radar: { ...DEFAULT_STATE.radar, ...(imported.radar || {}) },
      opportunities: Array.isArray(imported.opportunities) ? imported.opportunities : [],
      autoApply: { ...DEFAULT_STATE.autoApply, ...(imported.autoApply || {}) },
      applicationQueue: Array.isArray(imported.applicationQueue) ? imported.applicationQueue : [],
      resumeRewrite: imported.resumeRewrite || null,
      reviews: Array.isArray(imported.reviews) ? imported.reviews : [],
      plan: { ...DEFAULT_STATE.plan, ...(imported.plan || {}) },
      usage: { jobAnalyses: imported.usage?.jobAnalyses ?? imported.jobs.length },
      jobs: imported.jobs.map((job) => ({ channel: "platform", applicationTarget: "", ...job }))
    };
    saveState();
    showToast("数据已恢复");
    navigate("dashboard");
  } catch (error) {
    showToast(error.message || "导入失败");
  }
}

function bindEvents() {
  document.addEventListener("click", async (event) => {
    const go = event.target.closest("[data-go]");
    if (go) navigate(go.dataset.go);
    const nav = event.target.closest("[data-view]");
    if (nav) navigate(nav.dataset.view);
    const miniJob = event.target.closest("[data-job-id]");
    if (miniJob && !event.target.closest("select")) openJob(miniJob.dataset.jobId);
    const filter = event.target.closest("[data-filter]");
    if (filter) { pipelineFilter = filter.dataset.filter; renderPipeline(); }
    const open = event.target.closest("[data-open-job]");
    if (open) openJob(open.dataset.openJob);
    if (event.target.closest("#save-job")) saveCurrentJob();
    if (event.target.closest("#reset-analysis")) resetAnalysis();
    if (event.target.closest('[data-copy="greeting"]') && currentAnalysis) {
      await navigator.clipboard.writeText(currentAnalysis.greeting); showToast("招呼语已复制");
    }
    const dialogCopy = event.target.closest("[data-dialog-copy]");
    if (dialogCopy) {
      const job = state.jobs.find((item) => item.id === dialogCopy.dataset.dialogCopy);
      await navigator.clipboard.writeText(job?.analysis?.greeting || ""); showToast("招呼语已复制");
    }
    const dialogEdit = event.target.closest("[data-dialog-edit]");
    if (dialogEdit) editJob(dialogEdit.dataset.dialogEdit);
    const dialogDelete = event.target.closest("[data-dialog-delete]");
    if (dialogDelete) deleteJob(dialogDelete.dataset.dialogDelete);
    const prepare = event.target.closest("[data-prepare-application]");
    if (prepare) await prepareApplication(prepare.dataset.prepareApplication);
    if (event.target.closest("#career-analyze-btn")) analyzeCareer();
    if (event.target.closest("#rerun-career")) analyzeCareer();
    if (event.target.closest("#rerun-personality")) {
      state.personalityAnalysis = null;
      saveState();
      $("#personality-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (event.target.closest("#rerun-mbti")) {
      state.mbtiAnalysis = null;
      saveState();
      $("#mbti-form")?.reset();
      updateMbtiProgress();
      $("#mbti-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (event.target.closest("#copy-rewritten-resume") && state.resumeRewrite) {
      await navigator.clipboard.writeText(state.resumeRewrite.rewrittenResume); showToast("新版简历已复制");
    }
    if (event.target.closest("#save-rewritten-resume") && state.resumeRewrite) {
      state.profile.resumeText = state.resumeRewrite.rewrittenResume;
      state.careerAnalysis = null;
      saveState();
      showToast("新版简历已保存到个人档案");
    }
    const checkoutButton = event.target.closest("[data-checkout]");
    if (checkoutButton) await checkout(checkoutButton.dataset.checkout);
    const authModeButton = event.target.closest("[data-auth-mode]");
    if (authModeButton) {
      authMode = authModeButton.dataset.authMode;
      $$("[data-auth-mode]").forEach((button) => button.classList.toggle("is-active", button === authModeButton));
      $$(".register-only").forEach((node) => node.classList.toggle("hidden", authMode !== "register"));
      $("#account-submit").textContent = authMode === "login" ? "登录并同步" : "创建账号";
    }
    const review = event.target.closest("[data-review]");
    if (review) await runOutcomeReview(Number(review.dataset.review));
    if (event.target.closest("#enable-notifications")) await enableRadarNotifications();
    const deleteOpportunity = event.target.closest("[data-delete-opportunity]");
    if (deleteOpportunity) {
      state.opportunities = state.opportunities.filter((item) => item.id !== deleteOpportunity.dataset.deleteOpportunity);
      saveState();
      showToast("机会记录已删除");
    }
    const copyApplication = event.target.closest("[data-copy-application]");
    if (copyApplication) {
      const item = state.applicationQueue.find((application) => application.id === copyApplication.dataset.copyApplication);
      if (item) { await navigator.clipboard.writeText(`${item.greeting}\n\n${item.resumeText}`); showToast("招呼语和简历材料已复制"); }
    }
    const confirmBoss = event.target.closest("[data-confirm-boss]");
    if (confirmBoss) {
      const item = state.applicationQueue.find((application) => application.id === confirmBoss.dataset.confirmBoss);
      if (item) { item.status = "confirmed"; item.submittedAt = new Date().toISOString(); saveState(); showToast("已记录为确认投递"); track("boss_application_confirmed", { title: item.title, score: item.score }); }
    }
    const submitBoss = event.target.closest("[data-submit-boss]");
    if (submitBoss) await submitBossApplication(submitBoss.dataset.submitBoss);
  });

  $("#job-form").addEventListener("submit", analyzeJob);
  $("#personality-form").addEventListener("submit", analyzePersonality);
  $("#mbti-form").addEventListener("submit", analyzeMbti);
  $("#mbti-form").addEventListener("change", updateMbtiProgress);
  $("#radar-form").addEventListener("submit", saveRadarSettings);
  $("#opportunity-form").addEventListener("submit", addOpportunity);
  $("#autoapply-form").addEventListener("submit", prepareBossQueue);
  $("#source-collector-form").addEventListener("submit", collectSource);
  $("#resume-form").addEventListener("submit", rewriteResume);
  $("#resume-file").addEventListener("change", (event) => handleResumeFile(event.target.files[0]));
  $("#account-form").addEventListener("submit", submitAccount);
  $("#cloud-upload").addEventListener("click", uploadCloud);
  $("#cloud-download").addEventListener("click", downloadCloud);
  $("#account-logout").addEventListener("click", async () => {
    try { await apiFetch("/api/auth/logout", { method: "POST", headers: authHeaders() }); } catch {}
    authToken = ""; accountUser = null; localStorage.removeItem(AUTH_TOKEN_KEY); state.plan = { id: "free", reviewUsed: 0 }; saveState(); showToast("已退出账号");
  });
  $("#account-delete").addEventListener("click", async () => {
    if (!confirm("确定删除账号、云端档案、通知订阅和全部云端记录吗？此操作无法撤销。")) return;
    const response = await apiFetch("/api/account", { method: "DELETE", headers: authHeaders() });
    if (!response.ok) return showToast("账号删除失败，请稍后重试");
    authToken = ""; accountUser = null; localStorage.removeItem(AUTH_TOKEN_KEY); showToast("账号和云端数据已删除"); renderAll();
  });
  $("#profile-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.profile = Object.fromEntries(new FormData(event.currentTarget));
    state.careerAnalysis = null;
    state.resumeRewrite = null;
    saveState();
    showToast("求职档案已保存");
    navigate("dashboard");
  });
  $("#pipeline-body").addEventListener("change", (event) => {
    if (!event.target.matches(".stage-select")) return;
    const id = event.target.closest("tr").dataset.jobId;
    const job = state.jobs.find((item) => item.id === id);
    if (job) { job.stage = event.target.value; job.updatedAt = new Date().toISOString(); saveState(); showToast("投递阶段已更新"); track("application_stage_changed", { stage: job.stage, channel: job.channel, title: job.title }); }
  });
  $("#mobile-menu").addEventListener("click", () => document.body.classList.toggle("menu-open"));
  $("#export-data").addEventListener("click", exportData);
  $("#import-data").addEventListener("change", (event) => event.target.files[0] && importData(event.target.files[0]));
  $("#delete-data").addEventListener("click", () => {
    if (!confirm("确定永久删除当前浏览器中的全部求职数据吗？")) return;
    state = structuredClone(DEFAULT_STATE); state.deviceId = crypto.randomUUID(); localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LEGACY_STORAGE_KEY); renderAll(); showToast("全部本地数据已删除"); navigate("dashboard");
  });
  $(".dialog-close").addEventListener("click", () => $("#job-dialog").close());
}

async function init() {
  $("#today").textContent = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  bindEvents();
  try {
    const response = await apiFetch("/api/config");
    if (response.ok) config = await response.json();
  } catch {}
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("/sw.js"); } catch {}
  }
  await refreshAccount();
  renderAll();
  const initial = location.hash.slice(1);
  if (["dashboard", "career", "personality", "mbti", "radar", "autoapply", "resume", "analyze", "pipeline", "service", "profile", "settings"].includes(initial)) navigate(initial);
}

init();
