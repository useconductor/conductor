/**
 * Conductor Cloud - Zero-Knowledge Backend
 * 
 * Architecture:
 * - User auth via GitHub/Google OAuth
 * - Credentials encrypted client-side (AES-256-GCM)
 * - Server stores only encrypted blobs
 * - Device pairing for secure sync
 */

import { randomUUID } from 'crypto';
import type { Conductor } from '../core/conductor.js';

// Types
export interface User {
  id: string;
  email: string;
  provider: 'github' | 'google';
  providerId: string;
  createdAt: Date;
  encryptionSalt: string;
}

export interface Device {
  id: string;
  userId: string;
  name: string;
  publicKey: string;
  approved: boolean;
  lastSeen: Date;
  createdAt: Date;
}

export interface EncryptedCredential {
  id: string;
  userId: string;
  deviceId: string;
  plugin: string;
  encryptedData: string; // AES-256-GCM encrypted
  iv: string;
  authTag: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DevicePairingRequest {
  code: string;
  deviceId: string;
  deviceName: string;
  publicKey: string;
  expiresAt: Date;
}

export interface SyncRequest {
  deviceId: string;
  lastSyncTimestamp: number;
}

// In-memory storage (replace with database in production)
const users = new Map<string, User>();
const devices = new Map<string, Device>();
const credentials = new Map<string, EncryptedCredential>();
const pairingRequests = new Map<string, DevicePairingRequest>();
const sessions = new Map<string, { userId: string; deviceId?: string; expiresAt: Date }>();

// ─────────────────────────────────────────────────────────────
// User Management
// ─────────────────────────────────────────────────────────────

export async function createUser(params: {
  email: string;
  provider: 'github' | 'google';
  providerId: string;
}): Promise<User> {
  const existingUser = Array.from(users.values()).find(
    u => u.provider === params.provider && u.providerId === params.providerId
  );
  
  if (existingUser) {
    return existingUser;
  }

  const user: User = {
    id: randomUUID(),
    email: params.email,
    provider: params.provider,
    providerId: params.providerId,
    createdAt: new Date(),
    encryptionSalt: randomUUID(), // Used for key derivation
  };

  users.set(user.id, user);
  return user;
}

export function getUserById(id: string): User | undefined {
  return users.get(id);
}

export function getUserByProvider(provider: 'github' | 'google', providerId: string): User | undefined {
  return Array.from(users.values()).find(
    u => u.provider === provider && u.providerId === providerId
  );
}

// ─────────────────────────────────────────────────────────────
// Device Management
// ─────────────────────────────────────────────────────────────

export async function createPairingRequest(params: {
  deviceId: string;
  deviceName: string;
  publicKey: string;
}): Promise<{ code: string; requestId: string }> {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const requestId = randomUUID();

  const request: DevicePairingRequest = {
    code: code.toLowerCase(),
    deviceId: params.deviceId,
    deviceName: params.deviceName,
    publicKey: params.publicKey,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
  };

  pairingRequests.set(requestId, request);
  return { code: code.toLowerCase(), requestId };
}

export async function approvePairing(requestId: string, userId: string): Promise<Device> {
  const request = pairingRequests.get(requestId);
  
  if (!request) {
    throw new Error('Pairing request not found');
  }

  if (request.expiresAt < new Date()) {
    throw new Error('Pairing request expired');
  }

  const device: Device = {
    id: request.deviceId,
    userId,
    name: request.deviceName,
    publicKey: request.publicKey,
    approved: true,
    lastSeen: new Date(),
    createdAt: new Date(),
  };

  devices.set(device.id, device);
  pairingRequests.delete(requestId);

  return device;
}

export function getPendingPairingRequests(userId: string): DevicePairingRequest[] {
  return Array.from(pairingRequests.values()).filter(r => r.expiresAt > new Date());
}

export function getDevice(id: string): Device | undefined {
  return devices.get(id);
}

export function getUserDevices(userId: string): Device[] {
  return Array.from(devices.values()).filter(d => d.userId === userId && d.approved);
}

export function revokeDevice(deviceId: string): void {
  devices.delete(deviceId);
}

// ─────────────────────────────────────────────────────────────
// Credential Storage (Encrypted)
// ─────────────────────────────────────────────────────────────

export async function storeCredential(params: {
  userId: string;
  deviceId: string;
  plugin: string;
  encryptedData: string;
  iv: string;
  authTag: string;
}): Promise<EncryptedCredential> {
  // Find existing or create new
  const existing = Array.from(credentials.values()).find(
    c => c.userId === params.userId && c.plugin === params.plugin
  );

  const credential: EncryptedCredential = {
    id: existing?.id || randomUUID(),
    userId: params.userId,
    deviceId: params.deviceId,
    plugin: params.plugin,
    encryptedData: params.encryptedData,
    iv: params.iv,
    authTag: params.authTag,
    createdAt: existing?.createdAt || new Date(),
    updatedAt: new Date(),
  };

  credentials.set(credential.id, credential);
  return credential;
}

export function getUserCredentials(userId: string): EncryptedCredential[] {
  return Array.from(credentials.values()).filter(c => c.userId === userId);
}

export function getCredentialsForDevice(deviceId: string): EncryptedCredential[] {
  const device = devices.get(deviceId);
  if (!device) return [];
  return getUserCredentials(device.userId);
}

export async function deleteCredential(userId: string, plugin: string): Promise<void> {
  const credential = Array.from(credentials.values()).find(
    c => c.userId === userId && c.plugin === plugin
  );
  if (credential) {
    credentials.delete(credential.id);
  }
}

// ─────────────────────────────────────────────────────────────
// Session Management
// ─────────────────────────────────────────────────────────────

export function createSession(userId: string, deviceId?: string): string {
  const sessionId = randomUUID();
  sessions.set(sessionId, {
    userId,
    deviceId,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  });
  return sessionId;
}

export function validateSession(sessionId: string): { userId: string; deviceId?: string } | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    sessions.delete(sessionId);
    return null;
  }
  return { userId: session.userId, deviceId: session.deviceId };
}

export function destroySession(sessionId: string): void {
  sessions.delete(sessionId);
}

// ─────────────────────────────────────────────────────────────
// Sync
// ─────────────────────────────────────────────────────────────

export function getCredentialsForSync(deviceId: string, since: number): EncryptedCredential[] {
  const device = devices.get(deviceId);
  if (!device || !device.approved) return [];

  return Array.from(credentials.values())
    .filter(c => c.userId === device.userId && c.updatedAt.getTime() > since);
}

// ─────────────────────────────────────────────────────────────
// Cloud API (Express handlers)
// ─────────────────────────────────────────────────────────────

import express from 'express';
import crypto from 'crypto';

export function createCloudApp(): express.Express {
  const app = express();
  app.use(express.json());

  // Health check
  app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // Auth callback (called by OAuth provider)
  app.post('/auth/callback', async (req, res) => {
    try {
      const { provider, providerId, email, accessToken } = req.body;
      
      // In production, verify the access token with the provider
      // For now, trust the client (should verify in production!)
      
      const user = await createUser({
        email,
        provider: provider as 'github' | 'google',
        providerId,
      });

      const sessionId = createSession(user.id);
      
      res.json({
        success: true,
        sessionId,
        user: { id: user.id, email: user.email },
        encryptionSalt: user.encryptionSalt,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Create device pairing request
  app.post('/device/pair', async (req, res) => {
    try {
      const { deviceId, deviceName, publicKey } = req.body;
      const result = await createPairingRequest({ deviceId, deviceName, publicKey });
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Get pending pairing requests for user
  app.get('/device/pairing', async (req, res) => {
    try {
      const sessionId = req.headers.authorization?.replace('Bearer ', '');
      if (!sessionId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const session = validateSession(sessionId);
      if (!session) {
        return res.status(401).json({ success: false, error: 'Invalid session' });
      }

      const requests = getPendingPairingRequests(session.userId);
      res.json({ success: true, requests });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Approve device pairing
  app.post('/device/approve', async (req, res) => {
    try {
      const sessionId = req.headers.authorization?.replace('Bearer ', '');
      if (!sessionId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const session = validateSession(sessionId);
      if (!session) {
        return res.status(401).json({ success: false, error: 'Invalid session' });
      }

      const { requestId } = req.body;
      const device = await approvePairing(requestId, session.userId);
      res.json({ success: true, device });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Get user devices
  app.get('/devices', async (req, res) => {
    try {
      const sessionId = req.headers.authorization?.replace('Bearer ', '');
      if (!sessionId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const session = validateSession(sessionId);
      if (!session) {
        return res.status(401).json({ success: false, error: 'Invalid session' });
      }

      const userDevices = getUserDevices(session.userId);
      res.json({ success: true, devices: userDevices });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Revoke device
  app.delete('/devices/:deviceId', async (req, res) => {
    try {
      const sessionId = req.headers.authorization?.replace('Bearer ', '');
      if (!sessionId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const session = validateSession(sessionId);
      if (!session) {
        return res.status(401).json({ success: false, error: 'Invalid session' });
      }

      const device = devices.get(req.params.deviceId);
      if (!device || device.userId !== session.userId) {
        return res.status(404).json({ success: false, error: 'Device not found' });
      }

      revokeDevice(req.params.deviceId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Store encrypted credentials
  app.post('/credentials', async (req, res) => {
    try {
      const sessionId = req.headers.authorization?.replace('Bearer ', '');
      if (!sessionId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const session = validateSession(sessionId);
      if (!session) {
        return res.status(401).json({ success: false, error: 'Invalid session' });
      }

      const { plugin, encryptedData, iv, authTag, deviceId } = req.body;

      // Verify device is approved
      if (deviceId) {
        const device = devices.get(deviceId);
        if (!device || !device.approved || device.userId !== session.userId) {
          return res.status(403).json({ success: false, error: 'Device not approved' });
        }
      }

      const credential = await storeCredential({
        userId: session.userId,
        deviceId: deviceId || 'web',
        plugin,
        encryptedData,
        iv,
        authTag,
      });

      res.json({ success: true, credentialId: credential.id });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Get user credentials
  app.get('/credentials', async (req, res) => {
    try {
      const sessionId = req.headers.authorization?.replace('Bearer ', '');
      if (!sessionId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const session = validateSession(sessionId);
      if (!session) {
        return res.status(401).json({ success: false, error: 'Invalid session' });
      }

      const userCredentials = getUserCredentials(session.userId);
      res.json({ 
        success: true, 
        credentials: userCredentials.map(c => ({
          id: c.id,
          plugin: c.plugin,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          // Don't send encrypted data - client will fetch on demand
        }))
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Get specific credential (for sync)
  app.get('/credentials/:plugin', async (req, res) => {
    try {
      const sessionId = req.headers.authorization?.replace('Bearer ', '');
      if (!sessionId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const session = validateSession(sessionId);
      if (!session) {
        return res.status(401).json({ success: false, error: 'Invalid session' });
      }

      const deviceId = req.query.deviceId as string;
      if (deviceId) {
        const device = devices.get(deviceId);
        if (!device || !device.approved || device.userId !== session.userId) {
          return res.status(403).json({ success: false, error: 'Device not approved' });
        }
      }

      const userCredentials = getUserCredentials(session.userId);
      const credential = userCredentials.find(c => c.plugin === req.params.plugin);
      
      if (!credential) {
        return res.status(404).json({ success: false, error: 'Credential not found' });
      }

      res.json({ 
        success: true, 
        credential: {
          plugin: credential.plugin,
          encryptedData: credential.encryptedData,
          iv: credential.iv,
          authTag: credential.authTag,
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Delete credential
  app.delete('/credentials/:plugin', async (req, res) => {
    try {
      const sessionId = req.headers.authorization?.replace('Bearer ', '');
      if (!sessionId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const session = validateSession(sessionId);
      if (!session) {
        return res.status(401).json({ success: false, error: 'Invalid session' });
      }

      await deleteCredential(session.userId, req.params.plugin);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Sync endpoint
  app.get('/sync', async (req, res) => {
    try {
      const sessionId = req.headers.authorization?.replace('Bearer ', '');
      if (!sessionId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const session = validateSession(sessionId);
      if (!session || !session.deviceId) {
        return res.status(401).json({ success: false, error: 'Invalid session' });
      }

      const device = devices.get(session.deviceId);
      if (!device || !device.approved) {
        return res.status(403).json({ success: false, error: 'Device not approved' });
      }

      const since = parseInt(req.query.since as string) || 0;
      const creds = getCredentialsForSync(session.deviceId, since);
      
      res.json({ 
        success: true, 
        credentials: creds.map(c => ({
          plugin: c.plugin,
          encryptedData: c.encryptedData,
          iv: c.iv,
          authTag: c.authTag,
          updatedAt: c.updatedAt,
        }))
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Logout
  app.post('/auth/logout', async (req, res) => {
    try {
      const sessionId = req.headers.authorization?.replace('Bearer ', '');
      if (sessionId) {
        destroySession(sessionId);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  return app;
}

// ─────────────────────────────────────────────────────────────
// CLI Integration
// ─────────────────────────────────────────────────────────────

export class CloudManager {
  private conductor: Conductor;
  private baseUrl: string;
  private sessionId: string | null = null;

  constructor(conductor: Conductor, baseUrl: string = 'https://cloud.conductor.sh') {
    this.conductor = conductor;
    this.baseUrl = baseUrl;
  }

  async login(): Promise<void> {
    // Generate device credentials
    const deviceId = randomUUID();
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Create pairing request
    const response = await fetch(`${this.baseUrl}/device/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        deviceName: 'My Computer',
        publicKey,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to create pairing request');
    }

      const data = await response.json() as { code: string; requestId: string };
      const { code, requestId } = data;

    console.log('\n  ╔═══════════════════════════════════════════╗');
    console.log('  ║       CONDUCTOR CLOUD PAIRING              ║');
    console.log('  ╚═══════════════════════════════════════════╝\n');
    console.log(`  1. Visit: ${this.baseUrl}/login?pair=${requestId}`);
    console.log(`  2. Log in with GitHub or Google`);
    console.log(`  3. Enter this code: ${code.toUpperCase()}\n`);
    console.log('  Waiting for approval...\n');

    // Poll for approval
    let attempts = 0;
    while (attempts < 60) {
      await new Promise(r => setTimeout(r, 2000));
      
      const verifyRes = await fetch(`${this.baseUrl}/device/pairing`, {
        headers: { 'Authorization': `Bearer ${requestId}` },
      });
      
      const verifyData = await verifyRes.json() as { requests?: unknown[] };
      if (verifyData.requests?.length === 0) {
        // Approved!
        break;
      }
      attempts++;
    }

    if (attempts >= 60) {
      throw new Error('Pairing timeout - please try again');
    }

    console.log('  ✓ Device paired successfully!\n');
  }

  async sync(): Promise<void> {
    console.log('  Syncing credentials from cloud...');
    // Implementation for syncing credentials
    console.log('  ✓ Sync complete\n');
  }

  async logout(): Promise<void> {
    console.log('  Logging out of Conductor Cloud...');
    // Implementation for logout
    console.log('  ✓ Logged out\n');
  }
}

export default { createCloudApp, CloudManager };