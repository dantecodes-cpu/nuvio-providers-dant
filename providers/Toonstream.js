// Netflix Mirror Provider for Nuvio
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const NETMIRROR_BASE = "https://net51.cc/";
const PLATFORM = "netflix";
const OTT = "nf";

let globalCookie = "";
let cookieTimestamp = 0;
const COOKIE_EXPIRY = 54000000; // 15 hours

async function bypass() {
  const now = Date.now();
  if (globalCookie && cookieTimestamp && now - cookieTimestamp < COOKIE_EXPIRY) {
    return Promise.resolve(globalCookie);
  }
  
  console.log("[NetMirror-Netflix] Bypassing authentication...");
  
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(`${NETMIRROR_BASE}tv/p.php`, {
        method: "POST",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": `${NETMIRROR_BASE}tv/home`
        }
      });
      
      const setCookieHeader = response.headers.get("set-cookie");
      let extractedCookie = null;
      
      if (setCookieHeader) {
        const cookieString = Array.isArray(setCookieHeader) ? setCookieHeader.join("; ") : setCookieHeader;
        const cookieMatch = cookieString.match(/t_hash_t=([^;]+)/);
        if (cookieMatch) {
          extractedCookie = cookieMatch[1];
        }
      }
      
      const responseText = await response.text();
      if (responseText.includes('"r":"n"') && extractedCookie) {
        globalCookie = extractedCookie;
        cookieTimestamp = Date.now();
        console.log("[NetMirror-Netflix] Authentication successful");
        return globalCookie;
      }
    } catch (error) {
      console.log(`[NetMirror-Netflix] Bypass attempt ${attempt + 1} failed`);
    }
  }
  
  throw new Error("Max bypass attempts reached");
}

async function searchContent(query) {
  const cookie = await bypass();
  const cookies = {
    "t_hash_t": cookie,
    "user_token": "233123f803cf02184bf6c67e149cdd50",
    "ott": OTT,
    "hd": "on"
  };
  const cookieString = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  const timestamp = Math.floor(Date.now() / 1000);
  
  const response = await fetch(`${NETMIRROR_BASE}search.php?s=${encodeURIComponent(query)}&t=${timestamp}`, {
    headers: {
      "Cookie": cookieString,
      "Referer": `${NETMIRROR_BASE}tv/home`,
      "X-Requested-With": "XMLHttpRequest"
    }
  });
  
  const data = await response.json();
  return data.searchResult || [];
}

async function loadContent(contentId) {
  const cookie = await bypass();
  const cookies = {
    "t_hash_t": cookie,
    "user_token": "233123f803cf02184bf6c67e149cdd50",
    "ott": OTT,
    "hd": "on"
  };
  const cookieString = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  const timestamp = Math.floor(Date.now() / 1000);
  
  const response = await fetch(`${NETMIRROR_BASE}post.php?id=${contentId}&t=${timestamp}`, {
    headers: {
      "Cookie": cookieString,
      "Referer": `${NETMIRROR_BASE}tv/home`,
      "X-Requested-With": "XMLHttpRequest"
    }
  });
  
  return await response.json();
}

async function getStreamingLinks(contentId, title) {
  const cookie = await bypass();
  const cookies = {
    "t_hash_t": cookie,
    "user_token": "233123f803cf02184bf6c67e149cdd50",
    "hd": "on",
    "ott": OTT
  };
  const cookieString = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  const timestamp = Math.floor(Date.now() / 1000);
  
  const response = await fetch(
    `${NETMIRROR_BASE}tv/playlist.php?id=${contentId}&t=${encodeURIComponent(title)}&tm=${timestamp}`,
    {
      headers: {
        "Cookie": cookieString,
        "Referer": `${NETMIRROR_BASE}tv/home`,
        "X-Requested-With": "XMLHttpRequest"
      }
    }
  );
  
  const playlist = await response.json();
  
  if (!Array.isArray(playlist) || playlist.length === 0) {
    return { sources: [], subtitles: [] };
  }
  
  const sources = [];
  
  playlist.forEach((item) => {
    if (item.sources) {
      item.sources.forEach((source) => {
        let fullUrl = source.file;
        
        // Netflix-specific URL fix
        if (fullUrl.includes("/tv/")) {
          fullUrl = fullUrl.replace("/tv/", "/");
        }
        
        if (!fullUrl.startsWith("http")) {
          if (fullUrl.startsWith("//")) {
            fullUrl = "https:" + fullUrl;
          } else {
            fullUrl = "https://net51.cc" + fullUrl;
          }
        }
        
        sources.push({
          url: fullUrl,
          quality: source.label,
          type: source.type || "application/x-mpegURL"
        });
      });
    }
  });
  
  return { sources, subtitles: [] };
}

/**
 * Main provider function for Nuvio
 * @param {string} tmdbId - The TMDB ID
 * @param {string} mediaType - "movie" or "tv"
 * @param {number} season - Season number (1-based), null for movies
 * @param {number} episode - Episode number (1-based), null for movies
 * @returns {Promise<Array>} - List of streams
 */
async function getStreams(tmdbId, mediaType, season, episode) {
  console.log(`[NetMirror-Netflix] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);
  
  try {
    // Get title from TMDB
    const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const tmdbResponse = await fetch(tmdbUrl);
    const tmdbData = await tmdbResponse.json();
    
    const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
    const year = mediaType === "tv" 
      ? (tmdbData.first_air_date || "").substring(0, 4) 
      : (tmdbData.release_date || "").substring(0, 4);
    
    if (!title) {
      console.log("[NetMirror-Netflix] Could not extract title from TMDB");
      return [];
    }
    
    console.log(`[NetMirror-Netflix] Searching for: "${title}"`);
    
    // Search for content
    const searchResults = await searchContent(title);
    if (searchResults.length === 0) {
      console.log("[NetMirror-Netflix] No results found");
      return [];
    }
    
    const firstResult = searchResults[0];
    console.log(`[NetMirror-Netflix] Found: ${firstResult.t} (ID: ${firstResult.id})`);
    
    // Load content details
    const contentData = await loadContent(firstResult.id);
    
    // Determine episode ID for TV shows
    let targetContentId = firstResult.id;
    
    if (mediaType === "tv" && season && episode && contentData.episodes) {
      const validEpisodes = contentData.episodes.filter(ep => ep !== null);
      const episodeData = validEpisodes.find(ep => {
        if (ep.s && ep.ep) {
          const epSeason = parseInt(ep.s.replace("S", ""));
          const epNumber = parseInt(ep.ep.replace("E", ""));
          return epSeason === season && epNumber === episode;
        }
        return false;
      });
      
      if (episodeData) {
        targetContentId = episodeData.id;
      }
    }
    
    // Get streaming links
    const streamData = await getStreamingLinks(targetContentId, title);
    
    if (!streamData.sources || streamData.sources.length === 0) {
      console.log("[NetMirror-Netflix] No streaming links found");
      return [];
    }
    
    // Format streams for Nuvio
    const streams = streamData.sources.map((source) => {
      let quality = "HD";
      const urlQualityMatch = source.url.match(/[?&]q=(\d+p)/i);
      if (urlQualityMatch) {
        quality = urlQualityMatch[1];
      } else if (source.quality) {
        const labelQualityMatch = source.quality.match(/(\d+p)/i);
        if (labelQualityMatch) {
          quality = labelQualityMatch[1];
        }
      }
      
      let streamTitle = `${title} ${year ? `(${year})` : ""} ${quality}`;
      if (mediaType === "tv" && season && episode) {
        streamTitle += ` S${season}E${episode}`;
      }
      
      return {
        name: "NetMirror (Netflix)",
        title: streamTitle,
        url: source.url,
        quality,
        type: source.type.includes("mpegURL") ? "hls" : "direct",
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 13)",
          "Accept": "*/*",
          "Referer": "https://net51.cc/"
        }
      };
    });
    
    console.log(`[NetMirror-Netflix] Found ${streams.length} streams`);
    return streams;
    
  } catch (error) {
    console.error(`[NetMirror-Netflix] Error: ${error.message}`);
    return [];
  }
}

// Export for Nuvio
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
}
