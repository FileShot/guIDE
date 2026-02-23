import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getPostBySlug, getAllPosts } from '@/lib/blog';
import type { Metadata } from 'next';

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  return getAllPosts().map(post => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: 'Not Found' };
  return {
    title: post.title,
    description: post.description,
    keywords: post.tags,
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      publishedTime: post.date,
      authors: [post.author],
      url: `https://graysoft.dev/blog/${post.slug}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
    },
    alternates: { canonical: `https://graysoft.dev/blog/${post.slug}` },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  // Simple Markdown-like rendering
  const renderContent = (content: string) => {
    const lines = content.trim().split('\n');
    const elements: React.ReactNode[] = [];
    let inTable = false;
    let tableHeaders: string[] = [];
    let tableRows: string[][] = [];

    const renderInline = (text: string): React.ReactNode => {
      // Bold
      const parts = text.split(/(\*\*[^*]+\*\*)/g);
      return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>;
        }
        // Links
        const linkParts = part.split(/(\[[^\]]+\]\([^)]+\))/g);
        return linkParts.map((lp, j) => {
          const linkMatch = lp.match(/\[([^\]]+)\]\(([^)]+)\)/);
          if (linkMatch) {
            return <a key={`${i}-${j}`} href={linkMatch[2]} className="text-accent hover:underline">{linkMatch[1]}</a>;
          }
          return <span key={`${i}-${j}`}>{lp}</span>;
        });
      });
    };

    const flushTable = () => {
      if (tableHeaders.length > 0) {
        elements.push(
          <div key={`table-${elements.length}`} className="overflow-x-auto my-6 rounded-xl border border-white/[0.06]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {tableHeaders.map((h, i) => (
                    <th key={i} className={`px-4 py-2.5 text-neutral-300 font-medium ${i === 0 ? 'text-left' : 'text-center'}`}>
                      {renderInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, ri) => (
                  <tr key={ri} className="border-b border-white/[0.03] hover:bg-white/[0.03]">
                    {row.map((cell, ci) => (
                      <td key={ci} className={`px-4 py-2 ${ci === 0 ? 'text-neutral-300' : 'text-center'}`}>
                        {cell.trim() === '✅' ? <span className="text-emerald-400">✓</span> :
                         cell.trim() === '❌' ? <span className="text-neutral-600">—</span> :
                         cell.trim() === '⚡' ? <span className="text-yellow-400">⚡</span> :
                         renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        tableHeaders = [];
        tableRows = [];
      }
      inTable = false;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const cells = trimmed.split('|').filter(Boolean).map(c => c.trim());
        if (cells.every(c => /^[-:]+$/.test(c))) continue; // separator row
        if (!inTable) {
          flushTable();
          inTable = true;
          tableHeaders = cells;
        } else {
          tableRows.push(cells);
        }
        continue;
      } else if (inTable) {
        flushTable();
      }

      if (trimmed === '') {
        continue;
      } else if (trimmed.startsWith('## ')) {
        elements.push(<h2 key={i} className="text-2xl font-bold text-white mt-10 mb-4">{trimmed.slice(3)}</h2>);
      } else if (trimmed.startsWith('### ')) {
        elements.push(<h3 key={i} className="text-xl font-semibold text-white mt-8 mb-3">{trimmed.slice(4)}</h3>);
      } else if (trimmed.startsWith('- ')) {
        elements.push(
          <li key={i} className="text-neutral-300 leading-relaxed ml-4 list-disc mb-1">
            {renderInline(trimmed.slice(2))}
          </li>
        );
      } else if (/^\d+\.\s/.test(trimmed)) {
        elements.push(
          <li key={i} className="text-neutral-300 leading-relaxed ml-4 list-decimal mb-1">
            {renderInline(trimmed.replace(/^\d+\.\s/, ''))}
          </li>
        );
      } else {
        elements.push(
          <p key={i} className="text-neutral-300 leading-relaxed mb-4">
            {renderInline(trimmed)}
          </p>
        );
      }
    }
    if (inTable) flushTable();
    return elements;
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@additionalType': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    author: { '@type': 'Person', name: post.author },
    publisher: {
      '@type': 'Organization',
      name: 'GraySoft',
      logo: { '@type': 'ImageObject', url: 'https://graysoft.dev/logo.png' },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `https://graysoft.dev/blog/${post.slug}`,
    },
    url: `https://graysoft.dev/blog/${post.slug}`,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <article className="pt-24 pb-20 px-6">
        <div className="max-w-3xl mx-auto">
          <Link href="/blog" className="text-sm text-accent hover:underline mb-6 inline-block">
            &larr; Back to Blog
          </Link>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <time className="text-sm text-neutral-500">
              {new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </time>
            <span className="text-neutral-600">&middot;</span>
            <span className="text-sm text-neutral-500">{post.readTime}</span>
            <span className="text-neutral-600">&middot;</span>
            <span className="text-sm text-neutral-500">{post.author}</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4 leading-tight">
            {post.title}
          </h1>

          <p className="text-lg text-neutral-400 mb-8 leading-relaxed">
            {post.description}
          </p>

          <div className="flex flex-wrap gap-2 mb-10">
            {post.tags.map(tag => (
              <span key={tag} className="text-xs px-3 py-1 rounded-full bg-accent/10 text-accent border border-accent/20">
                {tag}
              </span>
            ))}
          </div>

          <div className="border-t border-white/[0.06] pt-8">
            {renderContent(post.content)}
          </div>

          <div className="border-t border-white/[0.06] mt-12 pt-8">
            <div className="rounded-xl border border-accent/20 bg-accent/5 p-8 text-center">
              <h3 className="text-xl font-bold text-white mb-2">Ready to try guIDE?</h3>
              <p className="text-neutral-400 mb-6">Download free. No subscription. No rate limits. No cloud required.</p>
              <Link
                href="/download"
                className="inline-block px-8 py-3 bg-accent hover:bg-accent-light text-white rounded-lg font-medium transition-all hover:shadow-[0_0_30px_rgba(0,122,204,0.25)]"
              >
                Download guIDE
              </Link>
            </div>
          </div>
        </div>
      </article>
    </>
  );
}
