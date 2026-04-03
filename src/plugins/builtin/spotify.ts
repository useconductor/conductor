/**
 * Spotify Plugin — TheAlxLabs / Conductor
 *
 * Full Spotify control: playback, search, playlists, queue, recommendations.
 * Uses Spotify Web API with OAuth 2.0 (Authorization Code + PKCE).
 *
 * Setup:
 *   1. https://developer.spotify.com/dashboard → Create App
 *   2. Add redirect URI: http://localhost:4839/spotify/callback
 *   3. Copy Client ID
 *   4. Run: conductor plugins auth spotify
 *      (opens browser for one-click OAuth — no client secret needed with PKCE)
 *
 * Keychain entries: spotify/access_token, spotify/refresh_token, spotify/client_id
 *
 * Auto-refreshes expired tokens transparently.
 */

import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';

const SPOTIFY_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_AUTH = 'https://accounts.spotify.com';
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-library-read',
  'user-library-modify',
  'user-top-read',
  'user-read-recently-played',
  'user-follow-read',
].join(' ');

export class SpotifyPlugin implements Plugin {
  name = 'spotify';
  description =
    'Full Spotify control — playback, search, playlists, queue, recommendations, top tracks';
  version = '1.0.0';

  configSchema = {
    fields: [
      {
        key: 'client_id',
        label: 'Spotify Client ID',
        type: 'string' as const,
        required: true,
        secret: false
      },
      {
        key: 'client_secret',
        label: 'Spotify Client Secret',
        type: 'password' as const,
        required: true,
        secret: true,
        service: 'spotify'
      }
    ],
    setupInstructions: 'Create an app in the Spotify Developer Dashboard. Set Redirect URI to http://localhost:8888/callback'
  };

  private keychain!: Keychain;
  private configDir!: string;

  async initialize(conductor: Conductor): Promise<void> {
    this.configDir = conductor.getConfig().getConfigDir();
    this.keychain = new Keychain(this.configDir);
  }

  isConfigured(): boolean {
    return true;
  }

  // ── Auth helpers ────────────────────────────────────────────────────────────

  private async getToken(): Promise<string> {
    let token = await this.keychain.get('spotify', 'access_token');
    if (!token) {
      throw new Error(
        'Spotify not authenticated.\n' +
        'Run: conductor plugins auth spotify\n' +
        'Or manually set: conductor plugins config spotify access_token <TOKEN>'
      );
    }
    return token;
  }

  /** Refresh the access token using the stored refresh token. */
  private async refreshToken(): Promise<string | null> {
    const refreshToken = await this.keychain.get('spotify', 'refresh_token');
    const clientId = await this.keychain.get('spotify', 'client_id');
    if (!refreshToken || !clientId) return null;

    const res = await fetch(`${SPOTIFY_AUTH}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    if (data.access_token) {
      await this.keychain.set('spotify', 'access_token', data.access_token);
      if (data.refresh_token) {
        await this.keychain.set('spotify', 'refresh_token', data.refresh_token);
      }
      return data.access_token;
    }
    return null;
  }

  // ── API fetch with auto-refresh ─────────────────────────────────────────────

  private async spotifyFetch(
    path: string,
    options: { method?: string; body?: any; params?: Record<string, string> } = {},
    retry = true
  ): Promise<any> {
    const token = await this.getToken();
    const url = new URL(`${SPOTIFY_BASE}${path}`);
    if (options.params) {
      for (const [k, v] of Object.entries(options.params)) url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    // Auto-refresh on 401
    if (res.status === 401 && retry) {
      const newToken = await this.refreshToken();
      if (newToken) {
        return this.spotifyFetch(path, options, false);
      }
      throw new Error('Spotify token expired and refresh failed. Run: conductor plugins auth spotify');
    }

    if (res.status === 204 || res.status === 202) return {};
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as any;
      throw new Error(`Spotify API ${res.status}: ${err.error?.message ?? res.statusText}`);
    }
    return res.json();
  }

  // ── Formatting helpers ──────────────────────────────────────────────────────

  private formatTrack(t: any) {
    return {
      id: t.id,
      name: t.name,
      artists: (t.artists ?? []).map((a: any) => a.name).join(', '),
      album: t.album?.name ?? '',
      duration: this.msToTime(t.duration_ms),
      popularity: t.popularity ?? 0,
      uri: t.uri,
      url: t.external_urls?.spotify ?? '',
      explicit: t.explicit ?? false,
    };
  }

  private formatPlaylist(p: any) {
    return {
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      owner: p.owner?.display_name ?? '',
      tracks: p.tracks?.total ?? 0,
      public: p.public ?? false,
      url: p.external_urls?.spotify ?? '',
      uri: p.uri,
    };
  }

  private msToTime(ms: number): string {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ── Tools ───────────────────────────────────────────────────────────────────

  getTools(): PluginTool[] {
    return [
      // ── spotify_now_playing ────────────────────────────────────────────────
      {
        name: 'spotify_now_playing',
        description: 'Get the currently playing track and playback state',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const data = await this.spotifyFetch('/me/player');
          if (!data || !data.item) return { playing: false, message: 'Nothing currently playing.' };
          return {
            playing: data.is_playing,
            track: this.formatTrack(data.item),
            device: {
              name: data.device?.name ?? 'Unknown',
              type: data.device?.type ?? '',
              volume: data.device?.volume_percent ?? 0,
            },
            shuffle: data.shuffle_state,
            repeat: data.repeat_state,
            progress: this.msToTime(data.progress_ms ?? 0),
            context: data.context?.type ?? null,
          };
        },
      },

      // ── spotify_search ─────────────────────────────────────────────────────
      {
        name: 'spotify_search',
        description: 'Search Spotify for tracks, albums, artists, or playlists',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            type: {
              type: 'string',
              enum: ['track', 'album', 'artist', 'playlist'],
              description: 'Type of result (default: track)',
            },
            limit: { type: 'number', description: 'Max results (default: 10)' },
          },
          required: ['query'],
        },
        handler: async ({ query, type = 'track', limit = 10 }: any) => {
          const data = await this.spotifyFetch('/search', {
            params: { q: query, type, limit: String(Math.min(limit, 50)) },
          });

          if (type === 'track') {
            return {
              count: data.tracks?.items?.length ?? 0,
              tracks: (data.tracks?.items ?? []).map(this.formatTrack.bind(this)),
            };
          }
          if (type === 'artist') {
            return {
              count: data.artists?.items?.length ?? 0,
              artists: (data.artists?.items ?? []).map((a: any) => ({
                id: a.id,
                name: a.name,
                genres: a.genres ?? [],
                followers: a.followers?.total ?? 0,
                popularity: a.popularity ?? 0,
                uri: a.uri,
                url: a.external_urls?.spotify ?? '',
              })),
            };
          }
          if (type === 'album') {
            return {
              count: data.albums?.items?.length ?? 0,
              albums: (data.albums?.items ?? []).map((a: any) => ({
                id: a.id,
                name: a.name,
                artists: (a.artists ?? []).map((x: any) => x.name).join(', '),
                releaseDate: a.release_date ?? '',
                tracks: a.total_tracks ?? 0,
                uri: a.uri,
                url: a.external_urls?.spotify ?? '',
              })),
            };
          }
          if (type === 'playlist') {
            return {
              count: data.playlists?.items?.length ?? 0,
              playlists: (data.playlists?.items ?? []).filter(Boolean).map(this.formatPlaylist.bind(this)),
            };
          }
          return data;
        },
      },

      // ── spotify_play ───────────────────────────────────────────────────────
      {
        name: 'spotify_play',
        description:
          'Start or resume playback. Can play a specific track, album, playlist, or artist by URI or search query.',
        inputSchema: {
          type: 'object',
          properties: {
            uri: {
              type: 'string',
              description: 'Spotify URI (e.g. spotify:track:xxx, spotify:album:xxx)',
            },
            query: {
              type: 'string',
              description: 'Search for and play this track/artist/album (used if no URI given)',
            },
            deviceId: { type: 'string', description: 'Target device ID (optional)' },
          },
        },
        handler: async ({ uri, query, deviceId }: any) => {
          let playUri = uri;

          // Auto-search if only query given
          if (!playUri && query) {
            const results = await this.spotifyFetch('/search', {
              params: { q: query, type: 'track', limit: '1' },
            });
            const track = results.tracks?.items?.[0];
            if (!track) return { error: `No track found for: "${query}"` };
            playUri = track.uri;
          }

          const body: any = {};
          if (playUri) {
            if (playUri.startsWith('spotify:track:')) {
              body.uris = [playUri];
            } else {
              body.context_uri = playUri;
            }
          }

          const params: Record<string, string> = {};
          if (deviceId) params.device_id = deviceId;

          await this.spotifyFetch('/me/player/play', {
            method: 'PUT',
            body,
            params,
          });

          // Fetch what's now playing to confirm
          await new Promise((r) => setTimeout(r, 500));
          const now = await this.spotifyFetch('/me/player/currently-playing').catch(() => null);
          return {
            playing: true,
            track: now?.item ? this.formatTrack(now.item) : null,
          };
        },
      },

      // ── spotify_pause ──────────────────────────────────────────────────────
      {
        name: 'spotify_pause',
        description: 'Pause Spotify playback',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          await this.spotifyFetch('/me/player/pause', { method: 'PUT' });
          return { paused: true };
        },
      },

      // ── spotify_skip ───────────────────────────────────────────────────────
      {
        name: 'spotify_skip',
        description: 'Skip to next or previous track',
        inputSchema: {
          type: 'object',
          properties: {
            direction: {
              type: 'string',
              enum: ['next', 'previous'],
              description: 'next or previous (default: next)',
            },
          },
        },
        handler: async ({ direction = 'next' }: any) => {
          const endpoint = direction === 'previous' ? '/me/player/previous' : '/me/player/next';
          await this.spotifyFetch(endpoint, { method: 'POST' });
          await new Promise((r) => setTimeout(r, 600));
          const now = await this.spotifyFetch('/me/player/currently-playing').catch(() => null);
          return {
            skipped: direction,
            now: now?.item ? this.formatTrack(now.item) : null,
          };
        },
      },

      // ── spotify_volume ─────────────────────────────────────────────────────
      {
        name: 'spotify_volume',
        description: 'Set Spotify playback volume (0–100)',
        inputSchema: {
          type: 'object',
          properties: {
            volume: { type: 'number', description: 'Volume 0–100' },
          },
          required: ['volume'],
        },
        handler: async ({ volume }: any) => {
          const vol = Math.max(0, Math.min(100, Math.round(volume)));
          await this.spotifyFetch('/me/player/volume', {
            method: 'PUT',
            params: { volume_percent: String(vol) },
          });
          return { volume: vol };
        },
      },

      // ── spotify_queue ──────────────────────────────────────────────────────
      {
        name: 'spotify_queue',
        description: 'Add a track to the playback queue by URI or search query',
        inputSchema: {
          type: 'object',
          properties: {
            uri: { type: 'string', description: 'Spotify track URI' },
            query: { type: 'string', description: 'Search for and queue this track' },
          },
        },
        handler: async ({ uri, query }: any) => {
          let trackUri = uri;
          if (!trackUri && query) {
            const results = await this.spotifyFetch('/search', {
              params: { q: query, type: 'track', limit: '1' },
            });
            const track = results.tracks?.items?.[0];
            if (!track) return { error: `No track found for: "${query}"` };
            trackUri = track.uri;
          }
          if (!trackUri) return { error: 'Provide uri or query.' };
          await this.spotifyFetch('/me/player/queue', {
            method: 'POST',
            params: { uri: trackUri },
          });
          return { queued: true, uri: trackUri };
        },
      },

      // ── spotify_playlists ──────────────────────────────────────────────────
      {
        name: 'spotify_playlists',
        description: "Get the current user's playlists",
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max playlists to return (default: 20)' },
          },
        },
        handler: async ({ limit = 20 }: any) => {
          const data = await this.spotifyFetch('/me/playlists', {
            params: { limit: String(Math.min(limit, 50)) },
          });
          return {
            count: data.items?.length ?? 0,
            total: data.total ?? 0,
            playlists: (data.items ?? []).map(this.formatPlaylist.bind(this)),
          };
        },
      },

      // ── spotify_playlist_tracks ────────────────────────────────────────────
      {
        name: 'spotify_playlist_tracks',
        description: 'Get tracks from a playlist',
        inputSchema: {
          type: 'object',
          properties: {
            playlistId: { type: 'string', description: 'Spotify playlist ID' },
            limit: { type: 'number', description: 'Max tracks (default: 20)' },
          },
          required: ['playlistId'],
        },
        handler: async ({ playlistId, limit = 20 }: any) => {
          const data = await this.spotifyFetch(`/playlists/${playlistId}/tracks`, {
            params: {
              limit: String(Math.min(limit, 100)),
              fields: 'items(track(id,name,artists,album,duration_ms,popularity,uri,external_urls)),total',
            },
          });
          return {
            total: data.total ?? 0,
            tracks: (data.items ?? [])
              .filter((i: any) => i.track)
              .map((i: any) => this.formatTrack(i.track)),
          };
        },
      },

      // ── spotify_top_tracks ─────────────────────────────────────────────────
      {
        name: 'spotify_top_tracks',
        description: "Get the user's top tracks or artists",
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['tracks', 'artists'],
              description: 'tracks or artists (default: tracks)',
            },
            timeRange: {
              type: 'string',
              enum: ['short_term', 'medium_term', 'long_term'],
              description: 'short_term=4wk, medium_term=6mo, long_term=all time (default: medium_term)',
            },
            limit: { type: 'number', description: 'Max results (default: 10)' },
          },
        },
        handler: async ({ type = 'tracks', timeRange = 'medium_term', limit = 10 }: any) => {
          const data = await this.spotifyFetch(`/me/top/${type}`, {
            params: { time_range: timeRange, limit: String(Math.min(limit, 50)) },
          });
          if (type === 'artists') {
            return {
              count: data.items?.length ?? 0,
              timeRange,
              artists: (data.items ?? []).map((a: any) => ({
                rank: (data.items as any[]).indexOf(a) + 1,
                name: a.name,
                genres: a.genres?.slice(0, 3) ?? [],
                popularity: a.popularity,
                url: a.external_urls?.spotify ?? '',
              })),
            };
          }
          return {
            count: data.items?.length ?? 0,
            timeRange,
            tracks: (data.items ?? []).map((t: any, i: number) => ({
              rank: i + 1,
              ...this.formatTrack(t),
            })),
          };
        },
      },

      // ── spotify_recommendations ────────────────────────────────────────────
      {
        name: 'spotify_recommendations',
        description:
          'Get personalized track recommendations based on seed tracks, artists, or genres',
        inputSchema: {
          type: 'object',
          properties: {
            seedTracks: {
              type: 'array',
              items: { type: 'string' },
              description: 'Up to 2 Spotify track IDs as seeds',
            },
            seedArtists: {
              type: 'array',
              items: { type: 'string' },
              description: 'Up to 2 Spotify artist IDs as seeds',
            },
            seedGenres: {
              type: 'array',
              items: { type: 'string' },
              description: 'Up to 2 genre strings (e.g. "pop", "hip-hop", "indie")',
            },
            limit: { type: 'number', description: 'Number of recommendations (default: 10)' },
            energy: { type: 'number', description: 'Target energy 0.0–1.0' },
            valence: { type: 'number', description: 'Target positivity/mood 0.0–1.0' },
            tempo: { type: 'number', description: 'Target BPM' },
          },
        },
        handler: async ({
          seedTracks = [],
          seedArtists = [],
          seedGenres = [],
          limit = 10,
          energy,
          valence,
          tempo,
        }: any) => {
          const totalSeeds = seedTracks.length + seedArtists.length + seedGenres.length;
          if (totalSeeds === 0) {
            // Use user's current top track as seed
            const top = await this.spotifyFetch('/me/top/tracks', {
              params: { limit: '1', time_range: 'short_term' },
            });
            const topTrack = top.items?.[0];
            if (topTrack) seedTracks = [topTrack.id];
            else return { error: 'Provide at least one seed (track, artist, or genre).' };
          }

          const params: Record<string, string> = {
            limit: String(Math.min(limit, 100)),
          };
          if (seedTracks.length) params.seed_tracks = seedTracks.slice(0, 2).join(',');
          if (seedArtists.length) params.seed_artists = seedArtists.slice(0, 2).join(',');
          if (seedGenres.length) params.seed_genres = seedGenres.slice(0, 2).join(',');
          if (energy !== undefined) params.target_energy = String(energy);
          if (valence !== undefined) params.target_valence = String(valence);
          if (tempo !== undefined) params.target_tempo = String(tempo);

          const data = await this.spotifyFetch('/recommendations', { params });
          return {
            count: data.tracks?.length ?? 0,
            tracks: (data.tracks ?? []).map(this.formatTrack.bind(this)),
          };
        },
      },

      // ── spotify_devices ────────────────────────────────────────────────────
      {
        name: 'spotify_devices',
        description: 'List available Spotify playback devices',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const data = await this.spotifyFetch('/me/player/devices');
          return {
            count: data.devices?.length ?? 0,
            devices: (data.devices ?? []).map((d: any) => ({
              id: d.id,
              name: d.name,
              type: d.type,
              active: d.is_active,
              volume: d.volume_percent,
              restricted: d.is_restricted,
            })),
          };
        },
      },

      // ── spotify_shuffle ────────────────────────────────────────────────────
      {
        name: 'spotify_shuffle',
        description: 'Toggle shuffle on or off',
        inputSchema: {
          type: 'object',
          properties: {
            state: { type: 'boolean', description: 'true = shuffle on, false = shuffle off' },
          },
          required: ['state'],
        },
        handler: async ({ state }: any) => {
          await this.spotifyFetch('/me/player/shuffle', {
            method: 'PUT',
            params: { state: String(state) },
          });
          return { shuffle: state };
        },
      },

      // ── spotify_recently_played ────────────────────────────────────────────
      {
        name: 'spotify_recently_played',
        description: "Get the user's recently played tracks",
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of tracks (default: 10, max: 50)' },
          },
        },
        handler: async ({ limit = 10 }: any) => {
          const data = await this.spotifyFetch('/me/player/recently-played', {
            params: { limit: String(Math.min(limit, 50)) },
          });
          return {
            count: data.items?.length ?? 0,
            tracks: (data.items ?? []).map((i: any) => ({
              ...this.formatTrack(i.track),
              playedAt: i.played_at,
            })),
          };
        },
      },
    ];
  }
}
