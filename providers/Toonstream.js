// Disney+ Mirror Provider
console.log("[NetMirror] Initializing Disney+ provider");

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const NETMIRROR_BASE = "https://net51.cc/";
const BASE_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.5",
  "Connection": "keep-alive"
};

let globalCookie = "";
let cookieTimestamp = 0;
const COOKIE_EXPIRY = 54e6;
const PLATFORM = "disney";
const OTT = "hs"; // Disney+ OTT code (hs for Hotstar/Disney+)

// Utility functions (same as Netflix)
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

function makeRequest(url, options = {}) {
  return fetch(url, __spreadProps(__spreadValues({}, options), {
    headers: __spreadValues(__spreadValues({}, BASE_HEADERS), options.headers),
    timeout: 1e4
  })).then(function(response) {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response;
  });
}

function getUnixTime() {
  return Math.floor(Date.now() / 1e3);
}

// Disney-specific bypass
function bypass() {
  const now = Date.now();
  if (globalCookie && cookieTimestamp && now - cookieTimestamp < COOKIE_EXPIRY) {
    console.log("[NetMirror-Disney] Using cached authentication cookie");
    return Promise.resolve(globalCookie);
  }
  console.log("[NetMirror-Disney] Bypassing authentication...");
  
  function attemptBypass(attempts) {
    if (attempts >= 5) {
      throw new Error("Max bypass attempts reached");
    }
    return makeRequest(`${NETMIRROR_BASE}tv/p.php`, {
      method: "POST",
      headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
        "Referer": `${NETMIRROR_BASE}tv/home`
      })
    }).then(function(response) {
      const setCookieHeader = response.headers.get("set-cookie");
      let extractedCookie = null;
      if (setCookieHeader && (typeof setCookieHeader === "string" || Array.isArray(setCookieHeader))) {
        const cookieString = Array.isArray(setCookieHeader) ? setCookieHeader.join("; ") : setCookieHeader;
        const cookieMatch = cookieString.match(/t_hash_t=([^;]+)/);
        if (cookieMatch) {
          extractedCookie = cookieMatch[1];
        }
      }
      return response.text().then(function(responseText) {
        if (!responseText.includes('"r":"n"')) {
          console.log(`[NetMirror-Disney] Bypass attempt ${attempts + 1} failed, retrying...`);
          return attemptBypass(attempts + 1);
        }
        if (extractedCookie) {
          globalCookie = extractedCookie;
          cookieTimestamp = Date.now();
          console.log("[NetMirror-Disney] Authentication successful");
          return globalCookie;
        }
        throw new Error("Failed to extract authentication cookie");
      });
    });
  }
  return attemptBypass(0);
}

// Disney-specific search
function searchContent(query) {
  console.log(`[NetMirror-Disney] Searching for "${query}"...`);
  return bypass().then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "user_token": "a0a5f663894ade410614071fe46baca6", // Disney token
      "ott": OTT,
      "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    return makeRequest(
      `${NETMIRROR_BASE}mobile/hs/search.php?s=${encodeURIComponent(query)}&t=${getUnixTime()}`,
      {
        headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
          "Cookie": cookieString,
          "Referer": `${NETMIRROR_BASE}tv/home`
        })
      }
    );
  }).then(function(response) {
    return response.json();
  }).then(function(searchData) {
    if (searchData.searchResult && searchData.searchResult.length > 0) {
      console.log(`[NetMirror-Disney] Found ${searchData.searchResult.length} results`);
      return searchData.searchResult.map((item) => ({
        id: item.id,
        title: item.t,
        platform: PLATFORM,
        posterUrl: `https://imgcdn.media/hs/v/${item.id}.jpg`
      }));
    } else {
      console.log("[NetMirror-Disney] No results found");
      return [];
    }
  });
}

// Disney-specific load content
function loadContent(contentId) {
  console.log(`[NetMirror-Disney] Loading content details for ID: ${contentId}`);
  return bypass().then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "user_token": "a0a5f663894ade410614071fe46baca6",
      "ott": OTT,
      "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    return makeRequest(
      `${NETMIRROR_BASE}mobile/hs/post.php?id=${contentId}&t=${getUnixTime()}`,
      {
        headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
          "Cookie": cookieString,
          "Referer": `${NETMIRROR_BASE}tv/home`
        })
      }
    );
  }).then(function(response) {
    return response.json();
  }).then(function(postData) {
    console.log(`[NetMirror-Disney] Loaded: ${postData.title}`);
    
    return {
      id: contentId,
      title: postData.title,
      description: postData.desc,
      year: postData.year,
      episodes: postData.episodes || [],
      seasons: postData.season || [],
      isMovie: !postData.episodes || postData.episodes.length === 0 || postData.episodes[0] === null,
      platform: PLATFORM
    };
  });
}

// Disney-specific streaming links
function getStreamingLinks(contentId, title) {
  console.log(`[NetMirror-Disney] Getting streaming links for: ${title}`);
  return bypass().then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "user_token": "a0a5f663894ade410614071fe46baca6",
      "hd": "on",
      "ott": OTT
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    return makeRequest(
      `${NETMIRROR_BASE}mobile/hs/playlist.php?id=${contentId}&t=${encodeURIComponent(title)}&tm=${getUnixTime()}`,
      {
        headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
          "Cookie": cookieString,
          "Referer": `${NETMIRROR_BASE}tv/home`
        })
      }
    );
  }).then(function(response) {
    return response.json();
  }).then(function(playlist) {
    if (!Array.isArray(playlist) || playlist.length === 0) {
      console.log("[NetMirror-Disney] No streaming links found");
      return { sources: [], subtitles: [] };
    }
    
    const sources = [];
    const subtitles = [];
    
    playlist.forEach((item) => {
      if (item.sources) {
        item.sources.forEach((source) => {
          let fullUrl = source.file;
          
          // Fix relative URLs
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
      
      if (item.tracks) {
        item.tracks.filter((track) => track.kind === "captions").forEach((track) => {
          let fullSubUrl = track.file;
          if (track.file.startsWith("/") && !track.file.startsWith("//")) {
            fullSubUrl = NETMIRROR_BASE + track.file;
          } else if (track.file.startsWith("//")) {
            fullSubUrl = "https:" + track.file;
          }
          subtitles.push({
            url: fullSubUrl,
            language: track.label
          });
        });
      }
    });
    
    console.log(`[NetMirror-Disney] Found ${sources.length} streaming sources and ${subtitles.length} subtitle tracks`);
    return { sources, subtitles };
  });
}

// Disney-specific stream getter
function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  console.log(`[NetMirror-Disney] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${seasonNum ? `, S${seasonNum}E${episodeNum}` : ""}`);
  
  const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  
  return makeRequest(tmdbUrl).then(function(tmdbResponse) {
    return tmdbResponse.json();
  }).then(function(tmdbData) {
    const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
    const year = mediaType === "tv" ? (tmdbData.first_air_date || "").substring(0, 4) : (tmdbData.release_date || "").substring(0, 4);
    
    if (!title) {
      throw new Error("Could not extract title from TMDB response");
    }
    
    console.log(`[NetMirror-Disney] TMDB Info: "${title}" (${year})`);
    
    return searchContent(title).then(function(searchResults) {
      if (searchResults.length === 0) {
        console.log("[NetMirror-Disney] No content found");
        return [];
      }
      
      // Filter for this platform only
      const platformResults = searchResults.filter(result => result.platform === PLATFORM);
      if (platformResults.length === 0) {
        console.log("[NetMirror-Disney] No Disney+ content found");
        return [];
      }
      
      const selectedContent = platformResults[0];
      console.log(`[NetMirror-Disney] Selected: ${selectedContent.title} (ID: ${selectedContent.id})`);
      
      return loadContent(selectedContent.id).then(function(contentData) {
        if (mediaType === "tv" && contentData.isMovie) {
          console.log("[NetMirror-Disney] Content is a movie, but we're looking for TV series");
          return [];
        }
        
        let targetContentId = selectedContent.id;
        
        if (mediaType === "tv" && !contentData.isMovie && seasonNum && episodeNum) {
          const validEpisodes = contentData.episodes.filter((ep) => ep !== null);
          const episodeData = validEpisodes.find((ep) => {
            let epSeason, epNumber;
            if (ep.s && ep.ep) {
              epSeason = parseInt(ep.s.replace("S", ""));
              epNumber = parseInt(ep.ep.replace("E", ""));
            }
            return epSeason === seasonNum && epNumber === episodeNum;
          });
          
          if (episodeData) {
            targetContentId = episodeData.id;
          }
        }
        
        return getStreamingLinks(targetContentId, title).then(function(streamData) {
          if (!streamData.sources || streamData.sources.length === 0) {
            console.log("[NetMirror-Disney] No streaming links found");
            return [];
          }
          
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
            if (mediaType === "tv" && seasonNum && episodeNum) {
              streamTitle += ` S${seasonNum}E${episodeNum}`;
            }
            
            return {
              name: `NetMirror (Disney+)`,
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
          
          console.log(`[NetMirror-Disney] Successfully processed ${streams.length} streams`);
          return streams;
        });
      });
    });
  }).catch(function(error) {
    console.error(`[NetMirror-Disney] Error in getStreams: ${error.message}`);
    return [];
  });
}

// Export Disney-specific functions
if (typeof module !== "undefined" && module.exports) {
  module.exports = { 
    getStreams,
    searchContent,
    loadContent,
    getStreamingLinks,
    platform: PLATFORM
  };
} else {
  window.NetMirrorDisney = { 
    getStreams,
    searchContent,
    loadContent,
    getStreamingLinks,
    platform: PLATFORM
  };
}
