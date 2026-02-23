import type { MetadataRoute } from 'next';
import { getAllComparisonPairs } from '@/data/benchmarks';
import { hfBenchmarkData, makeHFComparisonSlug } from '@/data/hf-benchmarks';

const BASE = 'https://graysoft.dev';
const today = new Date().toISOString().split('T')[0];

/**
 * Single sitemap at /sitemap.xml.
 * Includes core pages, blog posts, local benchmark comparisons,
 * all community model pages, and top community comparison pairs.
 * 
 * URL budget: ~50,000 max per sitemap file.
 * - Core + blog: ~20
 * - Local comparisons: ~10
 * - Community model pages: ~2,000
 * - Top community comparisons: ~11,000 (top 150 models, all pairs)
 * Total: ~13,000 URLs — well within limits.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // 1. Core pages
  const corePages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: today, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${BASE}/download`, lastModified: today, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE}/models`, lastModified: today, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/models/benchmarks`, lastModified: today, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE}/models/compare`, lastModified: today, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE}/about`, lastModified: today, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/community`, lastModified: today, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE}/blog`, lastModified: today, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE}/faq`, lastModified: today, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/projects`, lastModified: today, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/contact`, lastModified: today, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/login`, lastModified: today, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${BASE}/register`, lastModified: today, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE}/support`, lastModified: today, changeFrequency: 'monthly', priority: 0.5 },
  ];

  // 2. Blog posts
  const blogPosts: MetadataRoute.Sitemap = [
    'introducing-guide',
    'introducing-pocket-guide',
    'guide-vs-cursor',
    'guide-vs-windsurf',
    'guide-vs-vscode',
  ].map(slug => ({
    url: `${BASE}/blog/${slug}`,
    lastModified: today,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));

  // 3. Local benchmark comparisons (guIDE-tested models)
  const localComparisons: MetadataRoute.Sitemap = getAllComparisonPairs().map(pair => ({
    url: `${BASE}/models/compare/${pair.comparisonSlug}`,
    lastModified: today,
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }));

  // 4. Community model pages (all individual model pages)
  const communityModelPages: MetadataRoute.Sitemap = hfBenchmarkData.map(entry => ({
    url: `${BASE}/models/${entry.model.slug}`,
    lastModified: today,
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }));

  // 5. Community model comparison pairs (top 150 models by avg score)
  const TOP_N = 150;
  const topCommunity = hfBenchmarkData
    .slice() // already sorted by average desc in source
    .slice(0, TOP_N);
  
  const communityComparisons: MetadataRoute.Sitemap = [];
  for (let i = 0; i < topCommunity.length; i++) {
    for (let j = i + 1; j < topCommunity.length; j++) {
      const slug = makeHFComparisonSlug(topCommunity[i].model.name, topCommunity[j].model.name);
      communityComparisons.push({
        url: `${BASE}/models/compare/${slug}`,
        lastModified: today,
        changeFrequency: 'monthly' as const,
        priority: 0.4,
      });
    }
  }

  return [
    ...corePages,
    ...blogPosts,
    ...localComparisons,
    ...communityModelPages,
    ...communityComparisons,
  ];
}
