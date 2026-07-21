/**
 * Connection Profile Storage Service
 * Manages saving and loading connection profiles from disk.
 *
 * Credentials (auth tokens, OAuth client secrets) are encrypted at rest using
 * Electron's safeStorage (OS keychain-backed) rather than written in plaintext.
 * Older plaintext profiles are still readable and get upgraded to encrypted form
 * the next time they are saved.
 */

import path from 'path';
import fs from 'fs';
import { app, safeStorage } from 'electron';
import type { SavedProfile, AuthConfig } from '../src/shared/types';

// On-disk shape: the sensitive `auth` is stored encrypted as `authEnc`.
// `auth` may still appear on legacy profiles written before encryption existed.
type StoredProfile = Omit<SavedProfile, 'auth'> & {
  auth?: AuthConfig;
  authEnc?: string;
};

interface StoredData {
  profiles: StoredProfile[];
  lastUsedProfileId?: string;
}

export interface ProfilesData {
  profiles: SavedProfile[];
  lastUsedProfileId?: string;
}

export class ConnectionProfileStorage {
  private readonly configDir: string;
  private readonly configFilePath: string;

  constructor() {
    // Store profiles in app's user data directory
    this.configDir = path.join(app.getPath('userData'), 'lightcurve');
    this.configFilePath = path.join(this.configDir, 'profiles.json');
    this.ensureConfigDirExists();
  }

  private ensureConfigDirExists(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  private encryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  /** Encrypt an auth config to a base64 string, or undefined if there's nothing to encrypt. */
  private encryptAuth(auth?: AuthConfig): string | undefined {
    if (!auth) return undefined;
    try {
      return safeStorage.encryptString(JSON.stringify(auth)).toString('base64');
    } catch (err) {
      console.error('Failed to encrypt auth; storing without it:', err);
      return undefined;
    }
  }

  /** Decrypt a base64 authEnc string back to an AuthConfig. */
  private decryptAuth(authEnc?: string): AuthConfig | undefined {
    if (!authEnc) return undefined;
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(authEnc, 'base64'))) as AuthConfig;
    } catch (err) {
      console.error('Failed to decrypt stored credentials for a profile:', err);
      return undefined;
    }
  }

  /** Convert an on-disk profile to the decrypted public shape. */
  private toPublic(stored: StoredProfile): SavedProfile {
    const { authEnc, auth, ...rest } = stored;
    const decrypted = this.decryptAuth(authEnc);
    return { ...rest, auth: decrypted ?? auth };
  }

  /** Convert a public profile to the on-disk (encrypted) shape. */
  private toStored(profile: SavedProfile): StoredProfile {
    const { auth, ...rest } = profile;
    if (auth && this.encryptionAvailable()) {
      const authEnc = this.encryptAuth(auth);
      if (authEnc) return { ...rest, authEnc };
    }
    // No auth, or encryption unavailable (e.g. Linux without a keyring): fall back to plaintext.
    if (auth && !this.encryptionAvailable()) {
      console.warn('safeStorage unavailable; storing credentials without encryption');
    }
    return { ...rest, auth };
  }

  /**
   * Load all saved profiles
   */
  loadProfiles(): SavedProfile[] {
    return this.readStoredData().profiles.map(p => this.toPublic(p));
  }

  /**
   * Save a new profile or update existing one
   */
  saveProfile(profile: Omit<SavedProfile, 'profileId' | 'savedAt'>, profileId?: string): SavedProfile {
    const profiles = this.loadProfiles();

    // Check if a profile with same connection details already exists
    const existingProfile = profiles.find(p =>
      p.adminUrl === profile.adminUrl &&
      p.serviceUrl === profile.serviceUrl &&
      p.name === profile.name
    );

    const id = profileId || existingProfile?.profileId || `profile_${Date.now()}`;

    // Remove existing profile if updating
    const filtered = profiles.filter(p => p.profileId !== id);

    const savedProfile: SavedProfile = {
      ...profile,
      profileId: id,
      savedAt: Date.now(),
    };

    filtered.push(savedProfile);

    this.writeProfiles(filtered);
    return savedProfile;
  }

  /**
   * Delete a profile
   */
  deleteProfile(profileId: string): boolean {
    const profiles = this.loadProfiles();
    const filtered = profiles.filter(p => p.profileId !== profileId);

    if (filtered.length === profiles.length) {
      return false; // Profile not found
    }

    this.writeProfiles(filtered);
    return true;
  }

  /**
   * Get a specific profile by ID
   */
  getProfile(profileId: string): SavedProfile | null {
    const profiles = this.loadProfiles();
    return profiles.find(p => p.profileId === profileId) || null;
  }

  /**
   * Save last used profile ID
   */
  setLastUsedProfile(profileId: string): void {
    try {
      const data = this.readStoredData();
      data.lastUsedProfileId = profileId;
      this.atomicWrite(data);
    } catch (error) {
      console.error('Error saving last used profile:', error);
    }
  }

  /**
   * Get last used profile ID
   */
  getLastUsedProfileId(): string | undefined {
    try {
      return this.readStoredData().lastUsedProfileId;
    } catch {
      return undefined;
    }
  }

  /**
   * Get last used profile
   */
  getLastUsedProfile(): SavedProfile | null {
    const lastId = this.getLastUsedProfileId();
    if (!lastId) return null;
    return this.getProfile(lastId);
  }

  private readStoredData(): StoredData {
    try {
      if (!fs.existsSync(this.configFilePath)) {
        return { profiles: [] };
      }
      const data = fs.readFileSync(this.configFilePath, 'utf-8');
      const parsed = JSON.parse(data) as StoredData;
      return { profiles: parsed.profiles || [], lastUsedProfileId: parsed.lastUsedProfileId };
    } catch {
      return { profiles: [] };
    }
  }

  private writeProfiles(profiles: SavedProfile[]): void {
    try {
      const data = this.readStoredData();
      data.profiles = profiles.map(p => this.toStored(p));
      this.atomicWrite(data);
    } catch (error) {
      console.error('Error writing profiles:', error);
    }
  }

  /** Write to a temp file then rename, so a crash mid-write can't corrupt the store. */
  private atomicWrite(data: StoredData): void {
    const tmpPath = `${this.configFilePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.configFilePath);
  }
}
