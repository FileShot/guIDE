import { NextRequest, NextResponse } from 'next/server';
import { getCommunityPosts, createCommunityPost, addCommunityReply, likeCommunityPost } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rateLimit';

export async function GET() {
  try {
    const posts = getCommunityPosts();
    return NextResponse.json({ success: true, posts });
  } catch (err: any) {
    console.error('[Community GET]', err);
    return NextResponse.json({ success: false, error: 'Failed to fetch posts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 5 posts per 10 minutes per IP
    const rl = checkRateLimit(req, RATE_LIMITS.community);
    if (!rl.allowed) {
      const r = rateLimitResponse(rl);
      return NextResponse.json(r.body, { status: r.status, headers: r.headers });
    }

    // Require authentication for posting
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'You must be signed in to post' }, { status: 401 });
    }

    const body = await req.json();
    const { action } = body;

    if (action === 'create') {
      const { title, body: postBody, category } = body;
      if (!title?.trim() || !postBody?.trim()) {
        return NextResponse.json({ success: false, error: 'Title and body are required' }, { status: 400 });
      }
      if (title.length > 200 || postBody.length > 10000) {
        return NextResponse.json({ success: false, error: 'Input exceeds maximum length' }, { status: 400 });
      }
      const post = createCommunityPost(
        title.trim(),
        postBody.trim(),
        user.email,
        category || 'general'
      );
      return NextResponse.json({ success: true, post });
    }

    if (action === 'reply') {
      const { postId, body: replyBody } = body;
      if (!postId || !replyBody?.trim()) {
        return NextResponse.json({ success: false, error: 'Post ID and reply body are required' }, { status: 400 });
      }
      if (replyBody.length > 5000) {
        return NextResponse.json({ success: false, error: 'Reply exceeds maximum length' }, { status: 400 });
      }
      const post = addCommunityReply(postId, replyBody.trim(), user.email);
      if (!post) {
        return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, post });
    }

    if (action === 'like') {
      const { postId } = body;
      if (!postId) {
        return NextResponse.json({ success: false, error: 'Post ID is required' }, { status: 400 });
      }
      likeCommunityPost(postId, user.email);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    console.error('[Community POST]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
