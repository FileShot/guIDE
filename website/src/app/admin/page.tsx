'use client';

import { useEffect, useState } from 'react';
import {
  BarChart3, Users, Download, Eye, DollarSign, TrendingUp,
  Monitor, Terminal, Apple, Globe, ExternalLink, RefreshCw, Shield,
} from 'lucide-react';

interface Analytics {
  overview: {
    totalPageViews: number;
    totalUniqueVisitors: number;
    totalDownloads: number;
    totalUsers: number;
    totalLicenses: number;
    totalPurchases: number;
    totalRevenue: number;
    totalDonations: number;
    recentSignups: number;
  };
  today: { pageViews: number; uniqueVisitors: number; downloads: number };
  last7d: { pageViews: number; uniqueVisitors: number; downloads: number };
  last30d: { pageViews: number; uniqueVisitors: number; downloads: number };
  pageBreakdown: Record<string, number>;
  downloadBreakdown: Record<string, number>;
  referrerBreakdown: Record<string, number>;
  dailyViews: { date: string; views: number; unique: number }[];
  dailyDownloads: { date: string; count: number }[];
  recentUsers: { email: string; name: string | null; created_at: string }[];
}

function StatCard({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-5 ${accent ? 'border-accent/30 bg-accent/[0.04]' : 'border-white/[0.06] bg-white/[0.02]'}`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accent ? 'bg-accent/20 text-accent' : 'bg-white/[0.06] text-neutral-400'}`}>
          {icon}
        </div>
        <span className="text-sm text-neutral-400">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {sub && <div className="text-xs text-neutral-500 mt-1">{sub}</div>}
    </div>
  );
}

function MiniBar({ max, value, label }: { max: number; value: number; label: string }) {
  const pct = max > 0 ? Math.max((value / max) * 100, 2) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 text-sm text-neutral-300 truncate">{label}</div>
      <div className="flex-1 h-5 bg-white/[0.04] rounded-full overflow-hidden">
        <div className="h-full bg-accent/60 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="w-12 text-right text-sm font-medium text-neutral-300">{value}</div>
    </div>
  );
}

function SparklineChart({ data, color = '#007ACC' }: { data: number[]; color?: string }) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 1);
  const h = 60;
  const w = 100;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={`0,${h} ${points} ${w},${h}`}
        fill={`${color}15`}
        stroke="none"
      />
    </svg>
  );
}

export default function AdminPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'today' | '7d' | '30d' | 'all'>('30d');

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/analytics');
      if (res.status === 401) {
        setError('unauthorized');
        return;
      }
      if (!res.ok) throw new Error('Failed to load');
      setData(await res.json());
      setError(null);
    } catch {
      setError('Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) {
    return (
      <div className="pt-24 pb-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <BarChart3 className="text-accent animate-pulse" size={28} />
            <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-28 rounded-xl border border-white/[0.06] bg-white/[0.02] animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error === 'unauthorized') {
    return (
      <div className="pt-24 pb-20 px-6">
        <div className="max-w-md mx-auto text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <Shield size={32} className="text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-neutral-400">You must be signed in as an admin to view this page.</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="pt-24 pb-20 px-6">
        <div className="max-w-md mx-auto text-center">
          <h1 className="text-2xl font-bold text-white mb-2">Error</h1>
          <p className="text-neutral-400">{error}</p>
          <button onClick={fetchData} className="mt-4 px-4 py-2 bg-accent text-white rounded-lg">Retry</button>
        </div>
      </div>
    );
  }

  const period = tab === 'today' ? data.today : tab === '7d' ? data.last7d : tab === '30d' ? data.last30d : {
    pageViews: data.overview.totalPageViews,
    uniqueVisitors: data.overview.totalUniqueVisitors,
    downloads: data.overview.totalDownloads,
  };

  const sortedPages = Object.entries(data.pageBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxPageViews = sortedPages.length > 0 ? sortedPages[0][1] : 1;

  const sortedReferrers = Object.entries(data.referrerBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxRef = sortedReferrers.length > 0 ? sortedReferrers[0][1] : 1;

  const platformIcon = (p: string) => {
    if (p === 'windows') return <Monitor size={14} />;
    if (p === 'linux') return <Terminal size={14} />;
    if (p === 'mac') return <Apple size={14} />;
    return <Globe size={14} />;
  };

  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <BarChart3 className="text-accent" size={28} />
            <div>
              <h1 className="text-3xl font-bold text-white">Dashboard</h1>
              <p className="text-sm text-neutral-500">graysoft.dev analytics</p>
            </div>
          </div>
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] rounded-lg text-neutral-300 transition-colors"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {/* Period Tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06] mb-6 w-fit">
          {([['today', 'Today'], ['7d', '7 Days'], ['30d', '30 Days'], ['all', 'All Time']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === key ? 'bg-accent text-white' : 'text-neutral-400 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Top Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard icon={<Eye size={18} />} label="Page Views" value={period.pageViews} accent />
          <StatCard icon={<Users size={18} />} label="Unique Visitors" value={period.uniqueVisitors} />
          <StatCard icon={<Download size={18} />} label="Downloads" value={period.downloads} accent />
          <StatCard icon={<Users size={18} />} label="Registered Users" value={data.overview.totalUsers} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard icon={<Shield size={18} />} label="Active Licenses" value={data.overview.totalLicenses} />
          <StatCard icon={<DollarSign size={18} />} label="Revenue" value={`$${(data.overview.totalRevenue / 100).toFixed(2)}`} sub={`${data.overview.totalPurchases} purchases`} accent />
          <StatCard icon={<DollarSign size={18} />} label="Donations" value={`$${(data.overview.totalDonations / 100).toFixed(2)}`} />
          <StatCard icon={<TrendingUp size={18} />} label="New Users (30d)" value={data.overview.recentSignups} />
        </div>

        {/* Charts Row */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Page Views Chart */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <h3 className="text-sm font-medium text-neutral-300 mb-4">Page Views (30 days)</h3>
            <SparklineChart data={data.dailyViews.map(d => d.views)} />
            <div className="flex justify-between text-xs text-neutral-500 mt-1">
              <span>{data.dailyViews[0]?.date.slice(5)}</span>
              <span>{data.dailyViews[data.dailyViews.length - 1]?.date.slice(5)}</span>
            </div>
          </div>

          {/* Downloads Chart */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <h3 className="text-sm font-medium text-neutral-300 mb-4">Downloads (30 days)</h3>
            <SparklineChart data={data.dailyDownloads.map(d => d.count)} color="#10b981" />
            <div className="flex justify-between text-xs text-neutral-500 mt-1">
              <span>{data.dailyDownloads[0]?.date.slice(5)}</span>
              <span>{data.dailyDownloads[data.dailyDownloads.length - 1]?.date.slice(5)}</span>
            </div>
          </div>
        </div>

        {/* Details Row */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          {/* Top Pages */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <h3 className="text-sm font-medium text-neutral-300 mb-4">Top Pages</h3>
            <div className="space-y-2.5">
              {sortedPages.length === 0 && <p className="text-sm text-neutral-500">No data yet</p>}
              {sortedPages.map(([page, count]) => (
                <MiniBar key={page} label={page} value={count} max={maxPageViews} />
              ))}
            </div>
          </div>

          {/* Downloads by Platform */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <h3 className="text-sm font-medium text-neutral-300 mb-4">Downloads by Platform</h3>
            <div className="space-y-3">
              {Object.keys(data.downloadBreakdown).length === 0 && <p className="text-sm text-neutral-500">No downloads yet</p>}
              {Object.entries(data.downloadBreakdown).sort((a, b) => b[1] - a[1]).map(([platform, count]) => (
                <div key={platform} className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/[0.02]">
                  <div className="flex items-center gap-2 text-sm text-neutral-300 capitalize">
                    {platformIcon(platform)}
                    {platform}
                  </div>
                  <span className="text-sm font-medium text-white">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top Referrers */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <h3 className="text-sm font-medium text-neutral-300 mb-4">Traffic Sources</h3>
            <div className="space-y-2.5">
              {sortedReferrers.length === 0 && <p className="text-sm text-neutral-500">No data yet</p>}
              {sortedReferrers.map(([ref, count]) => {
                let display = ref;
                try { display = new URL(ref).hostname; } catch { display = ref; }
                return <MiniBar key={ref} label={display} value={count} max={maxRef} />;
              })}
            </div>
          </div>
        </div>

        {/* Recent Users */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <h3 className="text-sm font-medium text-neutral-300 mb-4">Recent Signups</h3>
          {data.recentUsers.length === 0 ? (
            <p className="text-sm text-neutral-500">No users yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-500 border-b border-white/[0.06]">
                    <th className="pb-2 font-medium">Email</th>
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium text-right">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentUsers.map((u, i) => (
                    <tr key={i} className="border-b border-white/[0.03]">
                      <td className="py-2.5 text-neutral-300">{u.email}</td>
                      <td className="py-2.5 text-neutral-400">{u.name || '—'}</td>
                      <td className="py-2.5 text-neutral-500 text-right">{new Date(u.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
