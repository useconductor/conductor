import crypto from 'crypto';

export interface VerificationCode {
  code: string;
  userId?: number;
  expiresAt: Date;
  used: boolean;
}

export class AuthManager {
  private codes: Map<string, VerificationCode> = new Map();

  /**
   * Generate a verification code like: CX-8F2K-9L4P
   */
  generateVerificationCode(): string {
    const part1 = this.randomString(2);
    const part2 = this.randomString(4);
    const part3 = this.randomString(4);

    const code = `${part1}-${part2}-${part3}`.toUpperCase();

    // Store with 5-minute expiry
    this.codes.set(code, {
      code,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      used: false,
    });

    return code;
  }

  /**
   * Verify a code and mark it as used.
   */
  verifyCode(code: string, userId: number): boolean {
    const storedCode = this.codes.get(code.toUpperCase());

    if (!storedCode) return false;
    if (storedCode.used) return false;
    if (storedCode.expiresAt < new Date()) return false;

    storedCode.used = true;
    storedCode.userId = userId;

    return true;
  }

  /**
   * Clean up expired codes.
   */
  cleanupExpiredCodes(): void {
    const now = new Date();
    for (const [code, data] of this.codes.entries()) {
      if (data.expiresAt < now) {
        this.codes.delete(code);
      }
    }
  }

  private randomString(length: number): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous chars
    let result = '';
    const bytes = crypto.randomBytes(length);

    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % chars.length];
    }

    return result;
  }
}
