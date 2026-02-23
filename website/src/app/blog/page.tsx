import Link from 'next/link';
import { getAllPosts } from '@/lib/blog';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Blog — guIDE AI IDE News & Comparisons',
  description: 'Read the latest news about guIDE, the first offline AI-powered IDE. Comparisons with Cursor, Windsurf, VS Code, tutorials, and updates.',
  keywords: ['AI IDE blog', 'Cursor alternative', 'Windsurf alternative', 'offline AI', 'local LLM', 'guIDE blog'],
  openGraph: {
    title: 'Blog — guIDE AI IDE',
    description: 'News, comparisons, and updates from guIDE — the first truly offline AI-powered IDE.',
    url: 'https://graysoft.dev/blog',
  },
  alternates: { canonical: 'https://graysoft.dev/blog' },
};

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-4xl mx-auto">
        <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">Blog</p>
        <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
          News & Insights
        </h1>
        <p className="text-neutral-400 mb-12 max-w-2xl">
          Comparisons, tutorials, and updates from the team behind guIDE — the first truly offline AI-powered IDE.
        </p>

        <div className="space-y-6">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="block group p-6 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-accent/30 hover:bg-white/[0.04] transition-all duration-300"
            >
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <time className="text-xs text-neutral-500">
                  {new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                </time>
                <span className="text-xs text-neutral-600">&middot;</span>
                <span className="text-xs text-neutral-500">{post.readTime}</span>
                {post.tags.slice(0, 3).map(tag => (
                  <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                    {tag}
                  </span>
                ))}
              </div>
              <h2 className="text-xl font-semibold text-white group-hover:text-accent transition-colors mb-2">
                {post.title}
              </h2>
              <p className="text-sm text-neutral-400 leading-relaxed line-clamp-2">
                {post.description}
              </p>
              <span className="inline-block mt-4 text-sm text-accent group-hover:underline">
                Read more &rarr;
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
