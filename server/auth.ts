// Passwords and login tokens. The token says who the caller is.
// Whether they are still allowed in is read from the users table on each request.

import { timingSafeEqual } from "jsr:@std/crypto/timing-safe-equal";
import type { Account, AccountStore } from "./store.ts";

const ITERATIONS = 600_000;
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const COOKIE = "auth";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const hmacKeys = new Map<string, Promise<CryptoKey>>();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME = /^[\p{L}\p{N}][\p{L}\p{N} _.'-]*$/u;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return null;
  return email;
}

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 24 || !USERNAME.test(name)) return null;
  return name;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveBits(password, salt, ITERATIONS);
  return `pbkdf2-sha256$${ITERATIONS}$${toBase64(salt)}$${toBase64(bits)}`;
}

export const dummyPasswordHash = await hashPassword("dummy-password-for-timing");

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4) return false;
  const [algo, rounds, saltB64, hashB64] = parts;
  const iterations = Number(rounds);
  if (algo !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) {
    return false;
  }
  const salt = fromBase64(saltB64);
  const expected = fromBase64(hashB64);
  if (!salt || !expected) return false;
  const actual = await deriveBits(password, salt, iterations);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export async function signToken(secret: string, userId: string, now = Date.now()): Promise<string> {
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = toBase64Url(encoder.encode(JSON.stringify({
    sub: userId,
    exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS,
  })));
  const data = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(data)));
  return `${data}.${toBase64Url(signature)}`;
}

export async function userIdFromToken(secret: string, token: string, now = Date.now()): Promise<string | null> {
  if (token.length > 2000) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const headerBytes = fromBase64Url(header);
  const signatureBytes = fromBase64Url(signature);
  if (!headerBytes || !signatureBytes) return null;
  let headerBody: { alg?: unknown };
  try {
    headerBody = JSON.parse(decoder.decode(headerBytes));
  } catch {
    return null;
  }
  if (headerBody.alg !== "HS256") return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    buffer(signatureBytes),
    encoder.encode(`${header}.${payload}`),
  );
  if (!valid) return null;
  const payloadBytes = fromBase64Url(payload);
  if (!payloadBytes) return null;
  let body: { sub?: unknown; exp?: unknown };
  try {
    body = JSON.parse(decoder.decode(payloadBytes));
  } catch {
    return null;
  }
  if (typeof body.sub !== "string" || body.sub.length < 1 || body.sub.length > 64) return null;
  if (typeof body.exp !== "number" || !Number.isInteger(body.exp)) return null;
  if (body.exp <= Math.floor(now / 1000)) return null;
  return body.sub;
}

export async function approvedUser(request: Request, accounts: AccountStore, secret: string): Promise<Account | null> {
  const token = readCookie(request.headers.get("cookie"), COOKIE);
  if (!token) return null;
  const id = await userIdFromToken(secret, token);
  if (!id) return null;
  const user = await accounts.findById(id);
  if (!user || user.status !== "approved") return null;
  return user;
}

export async function authCookie(secret: string, userId: string, request: Request): Promise<string> {
  const token = await signToken(secret, userId);
  return cookieHeader(token, request, TOKEN_TTL_SECONDS);
}

export function clearAuthCookie(request: Request): string {
  return cookieHeader("", request, 0);
}

function cookieHeader(token: string, request: Request, maxAge: number) {
  const parts = [`${COOKIE}=${token}`, "HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${maxAge}`];
  const forwarded = request.headers.get("x-forwarded-proto");
  if (new URL(request.url).protocol === "https:" || forwarded === "https") parts.push("Secure");
  return parts.join("; ");
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function hmacKey(secret: string) {
  let key = hmacKeys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    hmacKeys.set(secret, key);
  }
  return key;
}

async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: buffer(salt), iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function buffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new ArrayBuffer(bytes.byteLength);
  const view = new Uint8Array(copy);
  view.set(bytes);
  return view;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1) return null;
  return decode64(value);
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[-_A-Za-z0-9]+$/.test(value)) return null;
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return decode64(base64);
}

function decode64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
