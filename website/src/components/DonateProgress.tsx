'use client';

import { useState, useEffect } from 'react';
import { Heart, Loader2 } from 'lucide-react';

const presets = [5, 10, 25, 50];

export default function DonateProgress() {
  const [total, setTotal] = useState(0);
  const [goal] = useState(30000); // $300 in cents
  const [percentage, setPercentage] = useState(0);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [donated, setDonated] = useState(false);

  useEffect(() => {
    fetchTotal();
    // Check if just donated
    if (typeof window !== 'undefined' && window.location.search.includes('donated=true')) {
      setDonated(true);
    }
  }, []);

  const fetchTotal = async () => {
    try {
      const res = await fetch('/api/donate/total');
      const data = await res.json();
      if (data.success) {
        setTotal(data.total);
        setPercentage(data.percentage);
      }
    } catch {}
  };

  const handleDonate = async () => {
    const val = parseFloat(amount);
    if (!val || val < 1) return;
    setLoading(true);
    try {
      const res = await fetch('/api/donate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: val }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8">
      <div className="flex items-center gap-3 mb-4">
        <Heart size={20} className="text-pink-400" />
        <h3 className="text-lg font-semibold text-white">
          Help Us Get Code Signed
        </h3>
      </div>

      <p className="text-sm text-neutral-400 leading-relaxed mb-6">
        <span className="brand-font">guIDE</span> is built by an independent developer. A code signing certificate ($300)
        removes the Windows SmartScreen warning and proves the installer hasn&apos;t been
        tampered with. Every dollar helps.
      </p>

      {donated && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <p className="text-sm text-emerald-400 font-medium">
            Thank you for your donation! Your support helps make <span className="brand-font">guIDE</span> trusted by default.
          </p>
        </div>
      )}

      {/* Progress bar */}
      <div className="mb-2">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-neutral-400">
            ${(total / 100).toFixed(2)} raised
          </span>
          <span className="text-neutral-500">
            ${(goal / 100).toFixed(0)} goal
          </span>
        </div>
        <div className="w-full h-3 bg-white/[0.05] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-pink-500 to-accent rounded-full transition-all duration-1000 ease-out"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <p className="text-xs text-neutral-600 mt-1.5">{percentage}% funded</p>
      </div>

      {/* Preset amounts */}
      <div className="flex gap-2 mt-5 mb-3">
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => setAmount(String(p))}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              amount === String(p)
                ? 'bg-accent text-white'
                : 'bg-white/[0.04] text-neutral-400 hover:bg-white/[0.08] hover:text-white border border-white/[0.06]'
            }`}
          >
            ${p}
          </button>
        ))}
      </div>

      {/* Custom amount + donate button */}
      <div className="flex gap-3 mt-3">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">$</span>
          <input
            type="number"
            min="1"
            max="500"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Custom"
            className="w-full pl-7 pr-3 py-3 bg-white/[0.03] border border-white/10 rounded-lg text-white text-sm placeholder:text-neutral-600 focus:border-accent outline-none transition-colors"
          />
        </div>
        <button
          onClick={handleDonate}
          disabled={loading || !amount || parseFloat(amount) < 1}
          className="px-6 py-3 bg-pink-500 hover:bg-pink-400 text-white rounded-lg font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Heart size={16} />
          )}
          Donate
        </button>
      </div>
    </div>
  );
}
