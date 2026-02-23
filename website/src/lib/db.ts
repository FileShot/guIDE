import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'guide-db.json');

interface User {
  id: number;
  email: string;
  password_hash: string;
  name: string | null;
  stripe_customer_id: string | null;
  created_at: string;
}

interface License {
  id: number;
  user_id: number;
  license_key: string;
  machine_id: string | null;
  machine_ids: string[];
  plan: string;
  status: string;
  activated_at: string | null;
  created_at: string;
}

interface Purchase {
  id: number;
  user_id: number;
  stripe_session_id: string;
  stripe_payment_intent: string | null;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}

interface Contact {
  id: number;
  name: string;
  email: string;
  message: string;
  created_at: string;
}

interface Donation {
  id: number;
  stripe_session_id: string;
  stripe_payment_intent: string | null;
  amount: number;
  currency: string;
  donor_name: string | null;
  status: string;
  created_at: string;
}

interface AnalyticsEvent {
  id: number;
  type: 'page_view' | 'download' | 'signup' | 'purchase';
  page?: string;
  platform?: string;
  referrer?: string;
  ip_hash?: string;
  user_agent?: string;
  created_at: string;
}

interface CommunityReply {
  id: number;
  author: string;
  body: string;
  created_at: string;
}

interface CommunityPost {
  id: number;
  title: string;
  body: string;
  author: string;
  category: string;
  replies: CommunityReply[];
  likes: number;
  liked_by?: string[];  // Track who liked to prevent duplicates
  created_at: string;
}

interface Database {
  users: User[];
  licenses: License[];
  purchases: Purchase[];
  contacts: Contact[];
  donations: Donation[];
  communityPosts: CommunityPost[];
  analytics: AnalyticsEvent[];
  _nextId: { users: number; licenses: number; purchases: number; contacts: number; donations: number; communityPosts: number; communityReplies: number; analytics: number };
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readDb(): Database {
  ensureDir();
  if (!fs.existsSync(DB_PATH)) {
    const defaultDb: Database = {
      users: [],
      licenses: [],
      purchases: [],
      contacts: [],
      donations: [],
      communityPosts: [],
      analytics: [],
      _nextId: { users: 1, licenses: 1, purchases: 1, contacts: 1, donations: 1, communityPosts: 1, communityReplies: 1, analytics: 1 },
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultDb, null, 2));
    return defaultDb;
  }
  // Strip UTF-8 BOM if present before parsing
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8').replace(/^\uFEFF/, ''));
}

function writeDb(db: Database): void {
  ensureDir();
  // Atomic write: write to temp file, then rename (prevents corruption on crash)
  const tmpPath = DB_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2));
  fs.renameSync(tmpPath, DB_PATH);
}

function now(): string {
  return new Date().toISOString();
}

// ── User Operations ──

export function createUser(email: string, passwordHash: string, name?: string) {
  const db = readDb();
  const id = db._nextId.users++;
  const user: User = {
    id,
    email: email.toLowerCase(),
    password_hash: passwordHash,
    name: name || null,
    stripe_customer_id: null,
    created_at: now(),
  };
  db.users.push(user);
  writeDb(db);
  return { id, email: user.email, name: user.name };
}

export function getUserByEmail(email: string) {
  const db = readDb();
  return db.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) || undefined;
}

export function getUserById(id: number) {
  const db = readDb();
  const u = db.users.find((u) => u.id === id);
  if (!u) return undefined;
  return { id: u.id, email: u.email, name: u.name, stripe_customer_id: u.stripe_customer_id, created_at: u.created_at };
}

export function updateUserStripeCustomer(userId: number, stripeCustomerId: string) {
  const db = readDb();
  const user = db.users.find((u) => u.id === userId);
  if (user) {
    user.stripe_customer_id = stripeCustomerId;
    writeDb(db);
  }
}

// ── License Operations ──

export function createLicense(userId: number, licenseKey: string, plan: string = 'standard') {
  const db = readDb();
  const id = db._nextId.licenses++;
  const license: License = {
    id,
    user_id: userId,
    license_key: licenseKey,
    machine_id: null,
    machine_ids: [],
    plan,
    status: 'active',
    activated_at: now(),
    created_at: now(),
  };
  db.licenses.push(license);
  writeDb(db);
  return { userId, licenseKey, plan };
}

export function getLicenseByKey(key: string) {
  const db = readDb();
  const license = db.licenses.find((l) => l.license_key === key);
  if (!license) return undefined;
  const user = db.users.find((u) => u.id === license.user_id);
  return { ...license, email: user?.email };
}

export function getLicenseByUserId(userId: number) {
  const db = readDb();
  const active = db.licenses
    .filter((l) => l.user_id === userId && l.status === 'active')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return active[0] || undefined;
}

export function updateLicenseMachine(licenseId: number, machineId: string) {
  const db = readDb();
  const license = db.licenses.find((l) => l.id === licenseId);
  if (license) {
    // Migrate old single machine_id to machine_ids array
    if (!license.machine_ids) license.machine_ids = [];
    if (license.machine_id && !license.machine_ids.includes(license.machine_id)) {
      license.machine_ids.push(license.machine_id);
    }
    // Add new machine if not already tracked
    if (!license.machine_ids.includes(machineId)) {
      license.machine_ids.push(machineId);
    }
    license.machine_id = machineId; // Keep for backward compat
    writeDb(db);
  }
}

const MAX_MACHINES_PER_LICENSE = 2;

export function checkMachineLimit(licenseId: number, machineId: string): { allowed: boolean; machineCount: number; maxMachines: number } {
  const db = readDb();
  const license = db.licenses.find((l) => l.id === licenseId);
  if (!license) return { allowed: false, machineCount: 0, maxMachines: MAX_MACHINES_PER_LICENSE };
  const ids = license.machine_ids || [];
  // Already registered
  if (ids.includes(machineId)) return { allowed: true, machineCount: ids.length, maxMachines: MAX_MACHINES_PER_LICENSE };
  // Under limit
  if (ids.length < MAX_MACHINES_PER_LICENSE) return { allowed: true, machineCount: ids.length, maxMachines: MAX_MACHINES_PER_LICENSE };
  // Over limit
  return { allowed: false, machineCount: ids.length, maxMachines: MAX_MACHINES_PER_LICENSE };
}

export function removeLicenseMachine(licenseId: number, machineId: string) {
  const db = readDb();
  const license = db.licenses.find((l) => l.id === licenseId);
  if (license && license.machine_ids) {
    license.machine_ids = license.machine_ids.filter((id) => id !== machineId);
    if (license.machine_id === machineId) license.machine_id = license.machine_ids[0] || null;
    writeDb(db);
    return true;
  }
  return false;
}

export function deactivateLicense(licenseId: number) {
  const db = readDb();
  const license = db.licenses.find((l) => l.id === licenseId);
  if (license) {
    license.status = 'revoked';
    writeDb(db);
  }
}

// ── Purchase Operations ──

export function createPurchase(userId: number, stripeSessionId: string, amount: number, currency: string = 'usd') {
  const db = readDb();
  const id = db._nextId.purchases++;
  const purchase: Purchase = {
    id,
    user_id: userId,
    stripe_session_id: stripeSessionId,
    stripe_payment_intent: null,
    amount,
    currency,
    status: 'pending',
    created_at: now(),
  };
  db.purchases.push(purchase);
  writeDb(db);
  return { lastInsertRowid: id };
}

export function completePurchase(stripeSessionId: string, paymentIntent: string) {
  const db = readDb();
  const purchase = db.purchases.find((p) => p.stripe_session_id === stripeSessionId);
  if (purchase) {
    purchase.status = 'completed';
    purchase.stripe_payment_intent = paymentIntent;
    writeDb(db);
  }
  return purchase || undefined;
}

// ── Contact Operations ──

export function createContact(name: string, email: string, message: string) {
  const db = readDb();
  const id = db._nextId.contacts++;
  const contact: Contact = {
    id,
    name,
    email,
    message,
    created_at: now(),
  };
  db.contacts.push(contact);
  writeDb(db);
  return { lastInsertRowid: id };
}

// ── Donation Operations ──

export function createDonation(stripeSessionId: string, amount: number, currency: string = 'usd', donorName?: string) {
  const db = readDb();
  if (!db.donations) { db.donations = []; }
  if (!db._nextId.donations) { db._nextId.donations = 1; }
  const id = db._nextId.donations++;
  const donation: Donation = {
    id,
    stripe_session_id: stripeSessionId,
    stripe_payment_intent: null,
    amount,
    currency,
    donor_name: donorName || null,
    status: 'pending',
    created_at: now(),
  };
  db.donations.push(donation);
  writeDb(db);
  return { id };
}

export function completeDonation(stripeSessionId: string, paymentIntent: string) {
  const db = readDb();
  if (!db.donations) return undefined;
  const donation = db.donations.find((d) => d.stripe_session_id === stripeSessionId);
  if (donation) {
    donation.status = 'completed';
    donation.stripe_payment_intent = paymentIntent;
    writeDb(db);
  }
  return donation || undefined;
}

export function getDonationTotal(): number {
  const db = readDb();
  if (!db.donations) return 0;
  return db.donations
    .filter((d) => d.status === 'completed')
    .reduce((sum, d) => sum + d.amount, 0);
}

// ── OAuth User Operations ──

export function createOAuthUser(email: string, name?: string) {
  const db = readDb();
  const id = db._nextId.users++;
  const user: User = {
    id,
    email: email.toLowerCase(),
    password_hash: '__oauth_' + Math.random().toString(36).slice(2) + '__',
    name: name || null,
    stripe_customer_id: null,
    created_at: now(),
  };
  db.users.push(user);
  writeDb(db);
  return { id, email: user.email, name: user.name };
}

// ── Community Operations ──

export function getCommunityPosts() {
  const db = readDb();
  if (!db.communityPosts) db.communityPosts = [];
  return [...db.communityPosts].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function createCommunityPost(title: string, body: string, author: string, category: string) {
  const db = readDb();
  if (!db.communityPosts) db.communityPosts = [];
  if (!db._nextId.communityPosts) db._nextId.communityPosts = 1;
  if (!db._nextId.communityReplies) db._nextId.communityReplies = 1;
  const id = db._nextId.communityPosts++;
  const post: CommunityPost = {
    id,
    title,
    body,
    author,
    category,
    replies: [],
    likes: 0,
    created_at: now(),
  };
  db.communityPosts.push(post);
  writeDb(db);
  return post;
}

export function addCommunityReply(postId: number, body: string, author: string) {
  const db = readDb();
  if (!db.communityPosts) return undefined;
  if (!db._nextId.communityReplies) db._nextId.communityReplies = 1;
  const post = db.communityPosts.find(p => p.id === postId);
  if (!post) return undefined;
  if (!post.replies) post.replies = [];
  const reply: CommunityReply = {
    id: db._nextId.communityReplies++,
    author,
    body,
    created_at: now(),
  };
  post.replies.push(reply);
  writeDb(db);
  return post;
}

export function likeCommunityPost(postId: number, userEmail?: string) {
  const db = readDb();
  if (!db.communityPosts) return;
  const post = db.communityPosts.find(p => p.id === postId);
  if (post) {
    if (!post.liked_by) post.liked_by = [];
    // Prevent duplicate likes from same user
    if (userEmail && post.liked_by.includes(userEmail)) return;
    if (userEmail) post.liked_by.push(userEmail);
    post.likes = (post.likes || 0) + 1;
    writeDb(db);
  }
}

// ── Analytics Operations ──

export function trackEvent(type: AnalyticsEvent['type'], data: { page?: string; platform?: string; referrer?: string; ip_hash?: string; user_agent?: string }) {
  const db = readDb();
  if (!db.analytics) { db.analytics = []; }
  if (!db._nextId.analytics) { db._nextId.analytics = 1; }
  const id = db._nextId.analytics++;
  const event: AnalyticsEvent = {
    id,
    type,
    page: data.page || undefined,
    platform: data.platform || undefined,
    referrer: data.referrer || undefined,
    ip_hash: data.ip_hash || undefined,
    user_agent: data.user_agent || undefined,
    created_at: now(),
  };
  db.analytics.push(event);
  writeDb(db);
  return event;
}

export function getAnalytics() {
  const db = readDb();
  if (!db.analytics) db.analytics = [];

  const allEvents = db.analytics;
  const now_ = new Date();
  const today = new Date(now_.getFullYear(), now_.getMonth(), now_.getDate());
  const last7d = new Date(today.getTime() - 7 * 86400000);
  const last30d = new Date(today.getTime() - 30 * 86400000);

  const pageViews = allEvents.filter(e => e.type === 'page_view');
  const downloads = allEvents.filter(e => e.type === 'download');

  // Unique visitors by ip_hash
  const uniqueIps = (events: AnalyticsEvent[]) => new Set(events.map(e => e.ip_hash).filter(Boolean)).size;

  // Page view breakdown
  const pageBreakdown: Record<string, number> = {};
  for (const ev of pageViews) {
    const p = ev.page || '/';
    pageBreakdown[p] = (pageBreakdown[p] || 0) + 1;
  }

  // Download breakdown by platform
  const downloadBreakdown: Record<string, number> = {};
  for (const ev of downloads) {
    const p = ev.platform || 'unknown';
    downloadBreakdown[p] = (downloadBreakdown[p] || 0) + 1;
  }

  // Daily page views for last 30 days
  const dailyViews: { date: string; views: number; unique: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const dStr = d.toISOString().slice(0, 10);
    const dEnd = new Date(d.getTime() + 86400000);
    const dayEvents = pageViews.filter(e => {
      const t = new Date(e.created_at);
      return t >= d && t < dEnd;
    });
    dailyViews.push({
      date: dStr,
      views: dayEvents.length,
      unique: uniqueIps(dayEvents),
    });
  }

  // Daily downloads for last 30 days
  const dailyDownloads: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const dStr = d.toISOString().slice(0, 10);
    const dEnd = new Date(d.getTime() + 86400000);
    const dayDls = downloads.filter(e => {
      const t = new Date(e.created_at);
      return t >= d && t < dEnd;
    });
    dailyDownloads.push({ date: dStr, count: dayDls.length });
  }

  // Users & licenses from db
  const totalUsers = db.users.length;
  const totalLicenses = db.licenses.filter(l => l.status === 'active').length;
  const totalPurchases = db.purchases.filter(p => p.status === 'completed').length;
  const totalRevenue = db.purchases.filter(p => p.status === 'completed').reduce((s, p) => s + p.amount, 0);
  const totalDonations = (db.donations || []).filter(d => d.status === 'completed').reduce((s, d) => s + d.amount, 0);

  // Recent signups (last 30 days)
  const recentSignups = db.users.filter(u => new Date(u.created_at) >= last30d).length;

  // Referrer breakdown
  const referrerBreakdown: Record<string, number> = {};
  for (const ev of pageViews) {
    const r = ev.referrer || 'Direct';
    referrerBreakdown[r] = (referrerBreakdown[r] || 0) + 1;
  }

  return {
    overview: {
      totalPageViews: pageViews.length,
      totalUniqueVisitors: uniqueIps(pageViews),
      totalDownloads: downloads.length,
      totalUsers,
      totalLicenses,
      totalPurchases,
      totalRevenue,
      totalDonations,
      recentSignups,
    },
    today: {
      pageViews: pageViews.filter(e => new Date(e.created_at) >= today).length,
      uniqueVisitors: uniqueIps(pageViews.filter(e => new Date(e.created_at) >= today)),
      downloads: downloads.filter(e => new Date(e.created_at) >= today).length,
    },
    last7d: {
      pageViews: pageViews.filter(e => new Date(e.created_at) >= last7d).length,
      uniqueVisitors: uniqueIps(pageViews.filter(e => new Date(e.created_at) >= last7d)),
      downloads: downloads.filter(e => new Date(e.created_at) >= last7d).length,
    },
    last30d: {
      pageViews: pageViews.filter(e => new Date(e.created_at) >= last30d).length,
      uniqueVisitors: uniqueIps(pageViews.filter(e => new Date(e.created_at) >= last30d)),
      downloads: downloads.filter(e => new Date(e.created_at) >= last30d).length,
    },
    pageBreakdown,
    downloadBreakdown,
    referrerBreakdown,
    dailyViews,
    dailyDownloads,
    recentUsers: db.users.slice(-10).reverse().map(u => ({ email: u.email, name: u.name, created_at: u.created_at })),
  };
}
