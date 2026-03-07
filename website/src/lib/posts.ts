import fs from 'fs';
import path from 'path';

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  readTime: string;
  metaDescription: string;
  content: string;
}

/**
 * Path to posts.json. In standalone mode process.cwd() is the standalone dir,
 * so we allow overriding via BLOG_POSTS_PATH env var (set in ecosystem.config.cjs).
 * Blog-gen scripts use the same env var or fall back to the project absolute path.
 */
function getPostsPath(): string {
  return (
    process.env.BLOG_POSTS_PATH ||
    path.join(process.cwd(), 'data', 'posts.json')
  );
}

export function getAllPosts(): BlogPost[] {
  try {
    const raw = fs.readFileSync(getPostsPath(), 'utf-8');
    const posts: BlogPost[] = JSON.parse(raw);
    return posts.sort((a, b) => (a.date < b.date ? 1 : -1));
  } catch {
    return [];
  }
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return getAllPosts().find(p => p.slug === slug);
}
