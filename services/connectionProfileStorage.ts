/**
 * Connection Profile Storage Service
 * Manages saving and loading connection profiles from disk
 */

import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type { SavedProfile } from '../src/shared/types';

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

  /**
   * Load all saved profiles
   */
  loadProfiles(): SavedProfile[] {
    try {
      if (!fs.existsSync(this.configFilePath)) {
        return [];
      }
      const data = fs.readFileSync(this.configFilePath, 'utf-8');
      const parsed = JSON.parse(data) as ProfilesData;
      return parsed.profiles || [];
    } catch (error) {
      console.error('Error loading profiles:', error);
      return [];
    }
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
      const data = this.readProfilesData();
      data.lastUsedProfileId = profileId;
      fs.writeFileSync(this.configFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error saving last used profile:', error);
    }
  }

  /**
   * Get last used profile ID
   */
  getLastUsedProfileId(): string | undefined {
    try {
      const data = this.readProfilesData();
      return data.lastUsedProfileId;
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

  private readProfilesData(): ProfilesData {
    try {
      if (!fs.existsSync(this.configFilePath)) {
        return { profiles: [] };
      }
      const data = fs.readFileSync(this.configFilePath, 'utf-8');
      return JSON.parse(data) as ProfilesData;
    } catch {
      return { profiles: [] };
    }
  }

  private writeProfiles(profiles: SavedProfile[]): void {
    try {
      const data = this.readProfilesData();
      data.profiles = profiles;
      fs.writeFileSync(this.configFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error writing profiles:', error);
    }
  }
}
