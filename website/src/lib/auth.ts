import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';

const JWT_SECRET: string = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required. Set it in .env.local');
  }
  return secret;
})();
const COOKIE_NAME = 'guide_auth';
const TOKEN_EXPIRY = '30d';

interface TokenPayload {
  userId: number;
  email: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as TokenPayload;
  } catch {
    return null;
  }
}

export async function getAuthCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value;
}

export async function getCurrentUser(): Promise<TokenPayload | null> {
  const token = await getAuthCookie();
  if (!token) return null;
  return verifyToken(token);
}

export function createAuthCookieHeader(token: string): string {
  const maxAge = 30 * 24 * 60 * 60; // 30 days
  return `${COOKIE_NAME}=${token}; Path=/; Domain=.graysoft.dev; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}

export function clearAuthCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; Domain=.graysoft.dev; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}
