/**
 * HiAnime Scraper for Nuvio with TMDB & Kitsu Integration
 * Supports accurate anime title mapping and season detection
 * 
 * @author Your Name
 * @version 3.0.0
 */

const cheerio = require('cheerio-without-node-native');

// Configuration
const BASE_URL = 'https://hianime.to';
const API_BASE = 'https://hianime.to/ajax';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const KITSU_BASE_URL = 'https://kitsu.io/api/edge';

// Headers
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Referer': 'https://hianime.to/',
  'DNT': '1',
  'Connection': 'keep-alive'
};

const STREAM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://hianime.to',
  'Referer': 'https://hianime.to/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'cross-site'
};

const KITSU_HEADERS = {
  'Accept': 'application/vnd.api+json',
  'Content-Type': 'application/vnd.api+json'
};

// Utility functions
function safeString(str) {
  return typeof str === 'string' ? str : '';
}

function normalizeSeasonParts(title) {
  const s = safeString(title);
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/\d+(st|nd|rd|th)/g, (m) => m.replace(/st|nd|rd|th/, ''))
    .replace(/season|cour|part/g, '');
}

function normalize(str) {
  return safeString(str).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/**
 * Get TMDB TV show details
 */
function getTMDBDetails(tmdbId) {
  return new Promise((resolve, reject) => {
    const url = `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
    console.log(`[HiAnime] Fetching TMDB details for: ${tmdbId}`);
    
    fetch(url, { headers: HEADERS })
      .then(res => res.json())
      .then(data => {
        const title = data.name || data.original_name;
        const releaseDate = data.first_air_date;
        const year = releaseDate ? parseInt(releaseDate.split('-')[0]) : null;
        
        console.log(`[HiAnime] TMDB Title: ${title} (${year})`);
        
        resolve({
          title: title,
          originalTitle: data.original_name,
          year: year,
          genres: data.genres || [],
          externalIds: data.external_ids || {}
        });
      })
      .catch(error => {
        console.error(`[HiAnime] TMDB error:`, error);
        resolve({ title: null, year: null });
      });
  });
}

/**
 * Get TMDB season information
 */
function getTMDBSeasonInfo(tmdbId, seasonNum) {
  return new Promise((resolve, reject) => {
    const url = `${TMDB_BASE_URL}/tv/${tmdbId}/season/${seasonNum}?api_key=${TMDB_API_KEY}`;
    console.log(`[HiAnime] Fetching TMDB season ${seasonNum} for: ${tmdbId}`);
    
    fetch(url, { headers: HEADERS })
      .then(res => res.json())
      .then(data => {
        resolve({
          name: data.name,
          episodeCount: data.episodes ? data.episodes.length : 0,
          seasonNumber: data.season_number,
          airDate: data.air_date
        });
      })
      .catch(error => {
        console.error(`[HiAnime] TMDB season error:`, error);
        resolve({ name: null, episodeCount: 0, seasonNumber: seasonNum });
      });
  });
}

/**
 * Search Kitsu for anime
 */
function searchKitsu(animeTitle) {
  return new Promise((resolve, reject) => {
    const searchUrl = `${KITSU_BASE_URL}/anime?filter[text]=${encodeURIComponent(animeTitle)}&page[limit]=5`;
    console.log(`[HiAnime] Searching Kitsu for: ${animeTitle}`);
    
    fetch(searchUrl, { headers: KITSU_HEADERS })
      .then(res => res.json())
      .then(response => {
        const results = response.data || [];
        const normalizedQuery = animeTitle.toLowerCase().replace(/[^\w\s]/g, '').trim();
        
        // Filter for relevant matches
        const filtered = results.filter(entry => {
          const canonical = (entry.attributes.canonicalTitle || '').toLowerCase().replace(/[^\w\s]/g, '');
          const english = (entry.attributes.titles && entry.attributes.titles.en || '').toLowerCase().replace(/[^\w\s]/g, '');
          const romaji = (entry.attributes.titles && entry.attributes.titles.en_jp || '').toLowerCase().replace(/[^\w\s]/g, '');
          
          return canonical.includes(normalizedQuery) || 
                 english.includes(normalizedQuery) || 
                 romaji.includes(normalizedQuery) ||
                 normalizedQuery.includes(canonical);
        });
        
        console.log(`[HiAnime] Kitsu found ${filtered.length} matches`);
        resolve(filtered);
      })
      .catch(error => {
        console.error(`[HiAnime] Kitsu error:`, error);
        resolve([]);
      });
  });
}

/**
 * Get best anime title from TMDB and Kitsu
 */
function getBestAnimeTitle(tmdbId) {
  return new Promise((resolve, reject) => {
    getTMDBDetails(tmdbId)
      .then(tmdbData => {
        if (!tmdbData.title) {
          resolve({ title: null, year: null, source: 'none' });
          return;
        }
        
        // Try Kitsu first for more accurate anime titles
        return searchKitsu(tmdbData.title)
          .then(kitsuResults => {
            if (kitsuResults && kitsuResults.length > 0) {
              const bestMatch = kitsuResults[0];
              const kitsuTitle = bestMatch.attributes.titles.en || 
                                bestMatch.attributes.titles.en_jp ||
                                bestMatch.attributes.canonicalTitle;
              
              console.log(`[HiAnime] Using Kitsu title: ${kitsuTitle}`);
              
              resolve({
                title: kitsuTitle,
                alternativeTitles: [
                  tmdbData.title,
                  tmdbData.originalTitle,
                  bestMatch.attributes.canonicalTitle
                ].filter(Boolean),
                year: tmdbData.year,
                source: 'kitsu'
              });
            } else {
              // Fallback to TMDB title
              console.log(`[HiAnime] Using TMDB title: ${tmdbData.title}`);
              resolve({
                title: tmdbData.title,
                alternativeTitles: [tmdbData.originalTitle].filter(Boolean),
                year: tmdbData.year,
                source: 'tmdb'
              });
            }
          });
      })
      .catch(error => {
        console.error(`[HiAnime] Title resolution error:`, error);
        resolve({ title: null, year: null, source: 'error' });
      });
  });
}

/**
 * Extract MegaCloud sources
 */
function extractMegaCloud(embedUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(embedUrl);
    const baseDomain = `${url.protocol}//${url.host}/`;

    const headers = {
      'Accept': '*/*',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': baseDomain,
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36'
    };

    fetch(embedUrl, { headers })
      .then(r => r.text())
      .then(html => {
        const fileIdMatch = html.match(/<title>\s*File\s+#([a-zA-Z0-9]+)\s*-/i);
        if (!fileIdMatch) throw new Error('file_id not found');
        const fileId = fileIdMatch[1];

        let nonce = null;
        const match48 = html.match(/\b[a-zA-Z0-9]{48}\b/);
        if (match48) {
          nonce = match48[0];
        } else {
          const match3x16 = [...html.matchAll(/["']([A-Za-z0-9]{16})["']/g)];
          if (match3x16.length >= 3) {
            nonce = match3x16[0][1] + match3x16[1][1] + match3x16[2][1];
          }
        }
        if (!nonce) throw new Error('nonce not found');

        return fetch(
          `${baseDomain}embed-2/v3/e-1/getSources?id=${fileId}&_k=${nonce}`,
          { headers }
        );
      })
      .then(r => r.json())
      .then(sourcesJson => {
        resolve({
          sources: sourcesJson.sources,
          tracks: sourcesJson.tracks || [],
          intro: sourcesJson.intro || null,
          outro: sourcesJson.outro || null,
          server: sourcesJson.server || null
        });
      })
      .catch(reject);
  });
}

/**
 * Search for anime on HiAnime
 */
function searchAnime(query, year, isDub) {
  return new Promise((resolve, reject) => {
    const targetNorm = normalize(normalizeSeasonParts(query));
    const url = `${BASE_URL}/search?keyword=${encodeURIComponent(query)}&sy=${year || ''}&sort=default`;
    
    console.log(`[HiAnime] Searching: ${url}`);
    
    fetch(url, { headers: HEADERS })
      .then(res => res.text())
      .then(html => {
        const regex = /<a href="\/watch\/([^"]+)"[^>]+title="([^"]+)"[^>]+data-id="(\d+)"/g;
        const matches = [];
        let match;
        
        while ((match = regex.exec(html)) !== null) {
          const id = match[3];
          const pageUrl = match[1];
          const title = match[2];
          
          const jnameRegex = new RegExp(
            `<h3 class="film-name">[\\s\\S]*?<a[^>]+href="\\/${pageUrl}[^"]*"[^>]+data-jname="([^"]+)"`,
            'i'
          );
          const jnameMatch = html.match(jnameRegex);
          const jname = jnameMatch ? jnameMatch[1] : null;
          
          matches.push({
            id,
            pageUrl,
            title,
            normTitleJP: normalize(normalizeSeasonParts(jname)),
            normTitle: normalize(normalizeSeasonParts(title))
          });
        }
        
        if (matches.length === 0) {
          console.log(`[HiAnime] No results found`);
          resolve([]);
          return;
        }
        
        // Pick best match
        let best = matches.find(m => m.normTitleJP === targetNorm);
        let fallbackNorm = targetNorm;
        
        if (!best) best = matches.find(m => m.normTitle === targetNorm);
        
        if (!best) {
          best = matches.find(
            m => fallbackNorm.includes(m.normTitle) || m.normTitle.includes(fallbackNorm)
          );
        }
        
        if (!best) {
          matches.sort((a, b) => 
            levenshtein(a.normTitle, fallbackNorm) - levenshtein(b.normTitle, fallbackNorm)
          );
          best = matches[0];
        }
        
        console.log(`[HiAnime] Best match: ${best.title}`);
        
        resolve([{
          id: `${best.id}/${isDub ? 'dub' : 'sub'}`,
          title: best.title,
          url: `${BASE_URL}/${best.pageUrl}`,
          subOrDub: isDub ? 'dub' : 'sub'
        }]);
      })
      .catch(reject);
  });
}

/**
 * Find episodes for anime
 */
function findEpisodes(animeId) {
  return new Promise((resolve, reject) => {
    const [id, subOrDub] = animeId.split('/');
    console.log(`[HiAnime] Finding episodes for ID: ${id}`);
    
    fetch(`${API_BASE}/v2/episode/list/${id}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
      .then(res => res.json())
      .then(json => {
        const html = json.html;
        const episodes = [];
        const regex = /<a[^>]*class="[^"]*\bep-item\b[^"]*"[^>]*data-number="(\d+)"[^>]*data-id="(\d+)"[^>]*href="([^"]+)"[\s\S]*?<div class="ep-name[^"]*"[^>]*title="([^"]+)"/g;
        
        let match;
        while ((match = regex.exec(html)) !== null) {
          episodes.push({
            id: `${match[2]}/${subOrDub}`,
            number: parseInt(match[1], 10),
            url: BASE_URL + match[3],
            title: match[4]
          });
        }
        
        console.log(`[HiAnime] Found ${episodes.length} episodes`);
        resolve(episodes);
      })
      .catch(reject);
  });
}

/**
 * Find episode server and extract sources
 */
function findEpisodeServer(episodeId, serverName) {
  return new Promise((resolve, reject) => {
    const [id, subOrDub] = episodeId.split('/');
    const server = serverName !== 'default' ? serverName : 'HD-1';
    
    console.log(`[HiAnime] Finding server ${server} for episode ${id}`);
    
    if (server === 'HD-1' || server === 'HD-2' || server === 'HD-3') {
      fetch(`${API_BASE}/v2/episode/servers?episodeId=${id}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      })
        .then(res => res.json())
        .then(serverJson => {
          const serverHtml = serverJson.html;
          const regex = new RegExp(
            `<div[^>]*class="item server-item"[^>]*data-type="${subOrDub}"[^>]*data-id="(\\d+)"[^>]*>\\s*<a[^>]*>\\s*${server}\\s*</a>`,
            'i'
          );
          
          const match = regex.exec(serverHtml);
          if (!match) throw new Error(`Server "${server}" (${subOrDub}) not found`);
          
          const serverId = match[1];
          return fetch(`${API_BASE}/v2/episode/sources?id=${serverId}`, {
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
          });
        })
        .then(res => res.json())
        .then(sourcesJson => {
          return extractMegaCloud(sourcesJson.link)
            .catch(err => {
              console.warn('[HiAnime] Primary decrypter failed, trying fallback');
              return fetch(
                `https://ac-api.ofchaos.com/api/anime/embed/convert/v2?embedUrl=${encodeURIComponent(sourcesJson.link)}`
              ).then(r => r.json());
            });
        })
        .then(decryptData => {
          const streamSource =
            decryptData.sources.find(s => s.type === 'hls') ||
            decryptData.sources.find(s => s.type === 'mp4');
          
          if (!streamSource || !streamSource.file) {
            throw new Error('No valid stream file found');
          }
          
          const subtitles = (decryptData.tracks || [])
            .filter(t => t.kind === 'captions')
            .map((track, index) => ({
              id: `sub-${index}`,
              language: track.label || 'Unknown',
              url: track.file,
              isDefault: !!track.default
            }));
          
          resolve({
            server: server,
            headers: {
              'Referer': 'https://megacloud.club/',
              'Origin': 'https://megacloud.club',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            videoSources: [{
              url: streamSource.file,
              type: streamSource.type === 'hls' ? 'm3u8' : 'mp4',
              quality: 'auto',
              subtitles: subtitles
            }]
          });
        })
        .catch(reject);
        
    } else if (server === 'HD-4') {
      fetch(`https://megaplay.buzz/stream/s-2/${id}/${subOrDub}`, {
        headers: { 'Referer': 'https://megaplay.buzz/api' }
      })
        .then(res => {
          if (!res.ok) throw new Error('Episode not available');
          return res.text();
        })
        .then(iframeBody => {
          const dataIdMatch = iframeBody.match(/<title>\s*File\s+(\d+)\s*-\s*MegaPlay/i);
          if (!dataIdMatch) throw new Error('data-id not found');
          const dataId = dataIdMatch[1];
          
          return fetch(`https://megaplay.buzz/stream/getSources?id=${dataId}`, {
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
          });
        })
        .then(res => res.json())
        .then(fetchData => {
          const subtitles = (fetchData.tracks || [])
            .filter(t => t.kind === 'captions')
            .map((track, index) => ({
              id: `sub-${index}`,
              language: track.label || 'Unknown',
              url: track.file,
              isDefault: !!track.default
            }));
          
          resolve({
            server: server,
            headers: {
              'Accept': '*/*',
              'Referer': 'https://megaplay.buzz/',
              'Origin': 'https://megaplay.buzz',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            videoSources: [{
              url: fetchData.sources?.file,
              type: 'm3u8',
              quality: 'auto',
              subtitles: subtitles
            }]
          });
        })
        .catch(reject);
    } else {
      reject(new Error(`Unknown server: ${server}`));
    }
  });
}

/**
 * Main function: Get streams for TMDB content
 */
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return new Promise((resolve, reject) => {
    console.log(`[HiAnime] Starting - TMDB: ${tmdbId}, Season: ${seasonNum}, Episode: ${episodeNum}`);
    
    if (mediaType !== 'tv') {
      console.log('[HiAnime] Only TV shows supported');
      resolve([]);
      return;
    }
    
    let animeTitle = null;
    let titleData = null;
    
    // Get best anime title from TMDB + Kitsu
    getBestAnimeTitle(tmdbId)
      .then(data => {
        titleData = data;
        animeTitle = data.title;
        
        if (!animeTitle) {
          console.log('[HiAnime] Could not resolve anime title');
          resolve([]);
          return Promise.reject('No title');
        }
        
        // Search HiAnime with the resolved title
        return searchAnime(animeTitle, data.year, false);
      })
      .then(results => {
        if (results.length === 0) {
          console.log('[HiAnime] No search results');
          resolve([]);
          return Promise.reject('No results');
        }
        
        const anime = results[0];
        return findEpisodes(anime.id);
      })
      .then(episodes => {
        if (!episodes || episodes.length === 0) {
          console.log('[HiAnime] No episodes found');
          resolve([]);
          return Promise.reject('No episodes');
        }
        
        const targetEpisode = episodes.find(ep => ep.number === episodeNum) || episodes[0];
        
        if (!targetEpisode) {
          console.log(`[HiAnime] Episode ${episodeNum} not found`);
          resolve([]);
          return Promise.reject('Episode not found');
        }
        
        return findEpisodeServer(targetEpisode.id, 'HD-1');
      })
      .then(serverData => {
        if (!serverData) {
          resolve([]);
          return;
        }
        
        const mediaTitle = `${animeTitle} S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`;
        
        const streams = serverData.videoSources.map(source => ({
          name: `HiAnime ${serverData.server} - ${source.quality}`,
          title: mediaTitle,
          url: source.url,
          quality: source.quality,
          size: 'Unknown',
          headers: serverData.headers,
          provider: 'hianime',
          subtitles: source.subtitles
        }));
        
        console.log(`[HiAnime] Success! Found ${streams.length} streams`);
        resolve(streams);
      })
      .catch(error => {
        if (error !== 'No title' && error !== 'No results' && error !== 'No episodes' && error !== 'Episode not found') {
          console.error('[HiAnime] Error:', error);
        }
        resolve([]);
      });
  });
}

// Export for React Native compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getStreams,
    searchAnime,
    findEpisodes,
    findEpisodeServer,
    getTMDBDetails,
    searchKitsu,
    getBestAnimeTitle
  };
} else {
  global.getStreams = getStreams;
}
