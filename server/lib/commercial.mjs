import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

export const PLANS = [
  { id: "free", name: "免费体验", price: 0, days: null, analysisLimit: 10, resumeLimit: 1, radar: "manual", reviews: 0 },
  { id: "sprint14", name: "14 天求职冲刺", price: 59, days: 14, analysisLimit: 100, fairUse: true, resumeLimit: 12, radar: "daily", reviews: 2 },
  { id: "pro30", name: "30 天专业版", price: 129, days: 30, analysisLimit: 300, fairUse: true, resumeLimit: 30, radar: "instant", reviews: 4 },
  { id: "concierge30", name: "30 天陪跑版", price: 299, days: 30, analysisLimit: 500, fairUse: true, resumeLimit: 50, radar: "instant", reviews: 6, humanReview: true }
];

function publicUser(user) {
  if (!user) return null;
  const plan = PLANS.find((item) => item.id === user.plan?.id) || PLANS[0];
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt, plan: { ...user.plan, ...plan } };
}

function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  if (String(password).length < 8) throw new Error("密码至少需要 8 位");
  return { salt, hash: scryptSync(String(password), salt, 64).toString("hex") };
}

function verifyPassword(password, stored) {
  const candidate = Buffer.from(passwordHash(password, stored.salt).hash, "hex");
  const expected = Buffer.from(stored.hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function defaultData() {
  return { version: 1, users: [], sessions: [], cloudStates: {}, subscriptions: {}, notifications: {}, events: [], sources: {} };
}

export class CommercialStore {
  constructor(path) {
    this.path = path;
    this.data = defaultData();
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const loaded = JSON.parse(await readFile(this.path, "utf8"));
      this.data = { ...defaultData(), ...loaded };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.persist();
    }
    this.cleanupSessions();
    return this;
  }

  async persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      await rename(temporary, this.path);
    });
    return this.writeQueue;
  }

  cleanupSessions() {
    const now = Date.now();
    this.data.sessions = this.data.sessions.filter((item) => new Date(item.expiresAt).getTime() > now);
  }

  async register({ email, password, name }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("请输入有效邮箱");
    if (this.data.users.some((item) => item.email === normalizedEmail)) throw new Error("这个邮箱已经注册");
    const credentials = passwordHash(password);
    const user = {
      id: randomUUID(), email: normalizedEmail, name: String(name || "").trim().slice(0, 40), credentials,
      createdAt: new Date().toISOString(), plan: { id: "free", startedAt: new Date().toISOString(), expiresAt: null },
      usage: { planId: "free", analysis: 0, resume: 0 }
    };
    this.data.users.push(user);
    const session = this.createSession(user.id);
    await this.persist();
    return { user: publicUser(user), ...session };
  }

  async login({ email, password }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const user = this.data.users.find((item) => item.email === normalizedEmail);
    if (!user || !verifyPassword(String(password || ""), user.credentials)) throw new Error("邮箱或密码不正确");
    const session = this.createSession(user.id);
    await this.persist();
    return { user: publicUser(user), ...session };
  }

  createSession(userId) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    this.data.sessions.push({ token, userId, expiresAt });
    return { token, expiresAt };
  }

  userForToken(token) {
    this.cleanupSessions();
    const session = this.data.sessions.find((item) => item.token === token);
    return session ? this.data.users.find((item) => item.id === session.userId) : null;
  }

  async logout(token) {
    this.data.sessions = this.data.sessions.filter((item) => item.token !== token);
    await this.persist();
  }

  async saveCloudState(userId, state) {
    const serialized = JSON.stringify(state || {});
    if (Buffer.byteLength(serialized) > 2_000_000) throw new Error("云端数据超过 2MB 限制");
    this.data.cloudStates[userId] = { state, updatedAt: new Date().toISOString() };
    await this.persist();
    return this.data.cloudStates[userId];
  }

  cloudState(userId) { return this.data.cloudStates[userId] || null; }

  async saveSubscription(userId, subscription) {
    this.data.subscriptions[userId] ||= [];
    const endpoint = String(subscription?.endpoint || "");
    if (!endpoint.startsWith("https://")) throw new Error("通知订阅地址无效");
    this.data.subscriptions[userId] = this.data.subscriptions[userId].filter((item) => item.endpoint !== endpoint);
    this.data.subscriptions[userId].push({ ...subscription, createdAt: new Date().toISOString() });
    await this.persist();
  }

  async addNotification(userId, notification) {
    this.data.notifications[userId] ||= [];
    this.data.notifications[userId].unshift({ id: randomUUID(), read: false, createdAt: new Date().toISOString(), ...notification });
    this.data.notifications[userId] = this.data.notifications[userId].slice(0, 200);
    await this.persist();
  }

  notifications(userId) { return this.data.notifications[userId] || []; }

  async addEvent(userId, event) {
    this.data.events.push({ id: randomUUID(), userId: userId || null, type: String(event.type || "unknown").slice(0, 60), data: event.data || {}, at: new Date().toISOString() });
    this.data.events = this.data.events.slice(-10_000);
    await this.persist();
  }

  async activatePlan(userId, planId) {
    const plan = PLANS.find((item) => item.id === planId && item.price > 0);
    if (!plan) throw new Error("套餐不存在");
    const user = this.data.users.find((item) => item.id === userId);
    const startedAt = new Date();
    user.plan = { id: plan.id, startedAt: startedAt.toISOString(), expiresAt: new Date(startedAt.getTime() + plan.days * 86400000).toISOString() };
    user.usage = { planId: plan.id, analysis: 0, resume: 0 };
    await this.persist();
    return publicUser(user);
  }

  async consume(userId, feature) {
    const user = this.data.users.find((item) => item.id === userId);
    if (!user) throw new Error("账号不存在");
    if (user.plan?.expiresAt && new Date(user.plan.expiresAt).getTime() <= Date.now()) {
      user.plan = { id: "free", startedAt: new Date().toISOString(), expiresAt: null };
    }
    const plan = PLANS.find((item) => item.id === user.plan?.id) || PLANS[0];
    if (!user.usage || user.usage.planId !== plan.id) user.usage = { planId: plan.id, analysis: 0, resume: 0 };
    const key = feature === "resume" ? "resume" : "analysis";
    const limit = key === "resume" ? plan.resumeLimit : plan.analysisLimit;
    if (user.usage[key] >= limit) {
      const error = new Error(`${plan.name}的${key === "resume" ? "简历改写" : "岗位分析"}额度已用完`);
      error.code = "PLAN_LIMIT_REACHED";
      throw error;
    }
    user.usage[key] += 1;
    await this.persist();
    return { plan: safePlanForStore(plan), usage: { ...user.usage }, remaining: limit - user.usage[key] };
  }

  async saveSource(userId, source) {
    this.data.sources[userId] ||= [];
    const type = String(source.type || "official");
    const target = String(source.target || "").trim();
    const id = `${type}:${target}`;
    const previous = this.data.sources[userId].find((item) => item.id === id);
    const next = { id, type, target, enabled: true, createdAt: previous?.createdAt || new Date().toISOString(), lastSyncedAt: previous?.lastSyncedAt || null, seen: previous?.seen || [] };
    this.data.sources[userId] = this.data.sources[userId].filter((item) => item.id !== id).concat(next);
    await this.persist();
    return next;
  }

  allSources() {
    return Object.entries(this.data.sources).flatMap(([userId, sources]) => (sources || []).filter((item) => item.enabled).map((source) => ({ userId, source })));
  }

  async markSourceSynced(userId, sourceId, fingerprints) {
    const source = (this.data.sources[userId] || []).find((item) => item.id === sourceId);
    if (!source) return;
    source.lastSyncedAt = new Date().toISOString();
    source.seen = [...new Set([...(source.seen || []), ...fingerprints])].slice(-1000);
    await this.persist();
  }

  async deleteAccount(userId) {
    this.data.users = this.data.users.filter((item) => item.id !== userId);
    this.data.sessions = this.data.sessions.filter((item) => item.userId !== userId);
    delete this.data.cloudStates[userId];
    delete this.data.subscriptions[userId];
    delete this.data.notifications[userId];
    delete this.data.sources[userId];
    this.data.events = this.data.events.filter((item) => item.userId !== userId);
    await this.persist();
  }
}

export function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

export function publicAccount(user) { return publicUser(user); }

function safePlanForStore(plan) {
  const { id, name, price, days, analysisLimit, resumeLimit, radar, reviews, humanReview, fairUse } = plan;
  return { id, name, price, days, analysisLimit, resumeLimit, radar, reviews, humanReview: Boolean(humanReview), fairUse: Boolean(fairUse) };
}
