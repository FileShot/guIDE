'use client';

import { useState, useEffect } from 'react';
import FadeIn from '@/components/FadeIn';
import { MessageSquare, ThumbsUp, Clock, User, Send, Plus, ArrowLeft, Tag } from 'lucide-react';

interface CommunityPost {
  id: number;
  title: string;
  body: string;
  author: string;
  category: string;
  created_at: string;
  replies: CommunityReply[];
  likes: number;
}

interface CommunityReply {
  id: number;
  author: string;
  body: string;
  created_at: string;
}

const categories = [
  { id: 'general', label: 'General', color: 'text-violet-400 bg-violet-400/10 border-violet-400/20' },
  { id: 'help', label: 'Help & Support', color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  { id: 'showcase', label: 'Showcase', color: 'text-purple-400 bg-purple-400/10 border-purple-400/20' },
  { id: 'feature-request', label: 'Feature Request', color: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  { id: 'bug-report', label: 'Bug Report', color: 'text-red-400 bg-red-400/10 border-red-400/20' },
];

export default function CommunityPage() {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [selectedPost, setSelectedPost] = useState<CommunityPost | null>(null);
  const [showNewPost, setShowNewPost] = useState(false);
  const [newPost, setNewPost] = useState({ title: '', body: '', category: 'general' });
  const [replyText, setReplyText] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [userName, setUserName] = useState('');

  useEffect(() => {
    fetchPosts();
    // Check if user is logged in
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.user?.name) setUserName(d.user.name);
      else if (d.user?.email) setUserName(d.user.email.split('@')[0]);
    }).catch(() => {});
  }, []);

  const fetchPosts = async () => {
    try {
      const res = await fetch('/api/community');
      const data = await res.json();
      if (data.success) setPosts(data.posts || []);
    } catch { /* empty */ }
    setLoading(false);
  };

  const handleCreatePost = async () => {
    if (!newPost.title.trim() || !newPost.body.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/community', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', ...newPost, author: userName || 'Anonymous' }),
      });
      const data = await res.json();
      if (data.success) {
        setNewPost({ title: '', body: '', category: 'general' });
        setShowNewPost(false);
        fetchPosts();
      }
    } catch { /* empty */ }
    setSubmitting(false);
  };

  const handleReply = async () => {
    if (!replyText.trim() || !selectedPost) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/community', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reply', postId: selectedPost.id, body: replyText, author: userName || 'Anonymous' }),
      });
      const data = await res.json();
      if (data.success) {
        setReplyText('');
        fetchPosts();
        // Update selected post
        const updated = data.post;
        if (updated) setSelectedPost(updated);
      }
    } catch { /* empty */ }
    setSubmitting(false);
  };

  const handleLike = async (postId: number) => {
    try {
      await fetch('/api/community', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'like', postId }),
      });
      fetchPosts();
    } catch { /* empty */ }
  };

  const getCategoryStyle = (cat: string) => {
    return categories.find(c => c.id === cat)?.color || categories[0].color;
  };

  const getCategoryLabel = (cat: string) => {
    return categories.find(c => c.id === cat)?.label || 'General';
  };

  const filteredPosts = filter === 'all' ? posts : posts.filter(p => p.category === filter);

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  // Thread view
  if (selectedPost) {
    return (
      <div className="pt-24 pb-20 px-6">
        <div className="max-w-3xl mx-auto">
          <button onClick={() => setSelectedPost(null)} className="flex items-center gap-2 text-sm text-accent hover:underline mb-6">
            <ArrowLeft size={14} /> Back to discussions
          </button>

          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 mb-6">
            <div className="flex items-center gap-3 mb-3">
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getCategoryStyle(selectedPost.category)}`}>
                {getCategoryLabel(selectedPost.category)}
              </span>
              <span className="text-xs text-neutral-500">{timeAgo(selectedPost.created_at)}</span>
            </div>
            <h1 className="text-2xl font-bold text-white mb-3">{selectedPost.title}</h1>
            <p className="text-neutral-300 leading-relaxed whitespace-pre-wrap mb-4">{selectedPost.body}</p>
            <div className="flex items-center gap-4 text-xs text-neutral-500">
              <span className="flex items-center gap-1"><User size={12} /> {selectedPost.author}</span>
              <button onClick={() => handleLike(selectedPost.id)} className="flex items-center gap-1 hover:text-accent transition-colors">
                <ThumbsUp size={12} /> {selectedPost.likes}
              </button>
              <span className="flex items-center gap-1"><MessageSquare size={12} /> {selectedPost.replies?.length || 0} replies</span>
            </div>
          </div>

          {/* Replies */}
          <div className="space-y-4 mb-6">
            {(selectedPost.replies || []).map((reply) => (
              <div key={reply.id} className="rounded-lg border border-white/[0.04] bg-white/[0.015] p-4 ml-4">
                <p className="text-neutral-300 text-sm leading-relaxed whitespace-pre-wrap mb-2">{reply.body}</p>
                <div className="flex items-center gap-3 text-xs text-neutral-500">
                  <span className="flex items-center gap-1"><User size={11} /> {reply.author}</span>
                  <span>{timeAgo(reply.created_at)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Reply form */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <textarea
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              placeholder={userName ? 'Write a reply...' : 'Sign in to reply...'}
              rows={3}
              className="w-full bg-transparent border border-white/10 rounded-lg px-4 py-3 text-white text-sm placeholder:text-neutral-600 focus:border-accent outline-none resize-none mb-3"
            />
            <button
              onClick={handleReply}
              disabled={!replyText.trim() || submitting}
              className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-light text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              <Send size={14} /> {submitting ? 'Posting...' : 'Reply'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-4xl mx-auto">
        <FadeIn>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div>
              <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">Community</p>
              <h1 className="text-4xl sm:text-5xl font-bold text-white mb-2">Discussions</h1>
              <p className="text-neutral-400">Ask questions, share projects, and connect with other guIDE users.</p>
            </div>
            <button
              onClick={() => setShowNewPost(!showNewPost)}
              className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-light text-white rounded-lg text-sm font-medium transition-colors shrink-0"
            >
              <Plus size={16} /> New Discussion
            </button>
          </div>
        </FadeIn>

        {/* New post form */}
        {showNewPost && (
          <FadeIn>
            <div className="rounded-xl border border-accent/20 bg-accent/5 p-6 mb-8">
              <h3 className="text-lg font-semibold text-white mb-4">Start a Discussion</h3>
              <input
                value={newPost.title}
                onChange={e => setNewPost({ ...newPost, title: e.target.value })}
                placeholder="Title"
                className="w-full bg-transparent border border-white/10 rounded-lg px-4 py-3 text-white text-sm placeholder:text-neutral-600 focus:border-accent outline-none mb-3"
              />
              <textarea
                value={newPost.body}
                onChange={e => setNewPost({ ...newPost, body: e.target.value })}
                placeholder="What's on your mind?"
                rows={4}
                className="w-full bg-transparent border border-white/10 rounded-lg px-4 py-3 text-white text-sm placeholder:text-neutral-600 focus:border-accent outline-none resize-none mb-3"
              />
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="text-xs text-neutral-500">Category:</span>
                {categories.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setNewPost({ ...newPost, category: cat.id })}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                      newPost.category === cat.id ? cat.color : 'text-neutral-500 border-white/10 hover:border-white/20'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleCreatePost}
                  disabled={!newPost.title.trim() || !newPost.body.trim() || submitting}
                  className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-light text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <Send size={14} /> {submitting ? 'Posting...' : 'Post Discussion'}
                </button>
                <button
                  onClick={() => setShowNewPost(false)}
                  className="px-4 py-2 text-neutral-400 hover:text-white text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </FadeIn>
        )}

        {/* Category filter */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setFilter('all')}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filter === 'all' ? 'text-white bg-white/10 border-white/20' : 'text-neutral-500 border-white/10 hover:border-white/20'
            }`}
          >
            All
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setFilter(cat.id)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filter === cat.id ? cat.color : 'text-neutral-500 border-white/10 hover:border-white/20'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Posts list */}
        {loading ? (
          <div className="text-center py-20 text-neutral-500">Loading discussions...</div>
        ) : filteredPosts.length === 0 ? (
          <div className="text-center py-20">
            <MessageSquare size={40} className="text-neutral-700 mx-auto mb-4" />
            <p className="text-neutral-500 mb-2">No discussions yet</p>
            <p className="text-neutral-600 text-sm">Be the first to start a conversation!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredPosts.map(post => (
              <button
                key={post.id}
                onClick={() => setSelectedPost(post)}
                className="w-full text-left p-5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-accent/30 hover:bg-white/[0.04] transition-all duration-300"
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getCategoryStyle(post.category)}`}>
                    {getCategoryLabel(post.category)}
                  </span>
                  <span className="text-xs text-neutral-500">{timeAgo(post.created_at)}</span>
                </div>
                <h3 className="text-base font-semibold text-white mb-1">{post.title}</h3>
                <p className="text-sm text-neutral-400 line-clamp-2 mb-3">{post.body}</p>
                <div className="flex items-center gap-4 text-xs text-neutral-500">
                  <span className="flex items-center gap-1"><User size={11} /> {post.author}</span>
                  <span className="flex items-center gap-1"><ThumbsUp size={11} /> {post.likes}</span>
                  <span className="flex items-center gap-1"><MessageSquare size={11} /> {post.replies?.length || 0}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
