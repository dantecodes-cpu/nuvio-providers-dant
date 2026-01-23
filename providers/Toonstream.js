// Netflix Mirror Provider
console.log("[NetMirror] Initializing Netflix provider");

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
const PLATFORM = "netflix";
const OTT = "nf"; // Netflix OTT code

// Utility functions
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

// Netflix-specific bypass
function bypass() {
  const now = Date.now();
  if (globalCookie && cookieTimestamp && now - cookieTimestamp < COOKIE_EXPIRY) {
    console.log("[NetMirror-Netflix] Using cached authentication cookie");
    return Promise.resolve(globalCookie);
  }
  console.log("[NetMirror-Netflix] Bypassing authentication...");
  
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
          console.log(`[NetMirror-Netflix] Bypass attempt ${attempts + 1} failed, retrying...`);
          return attemptBypass(attempts + 1);
        }
        if (extractedCookie) {
          globalCookie = extractedCookie;
          cookieTimestamp = Date.now();
          console.log("[NetMirror-Netflix] Authentication successful");
          return globalCookie;
        }
        throw new Error("Failed to extract authentication cookie");
      });
    });
  }
  return attemptBypass(0);
}

// Netflix-specific search
function searchContent(query) {
  console.log(`[NetMirror-Netflix] Searching for "${query}"...`);
  return bypass().then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "user_token": "233123f803cf02184bf6c67e149cdd50", // Netflix-specific token
      "ott": OTT,
      "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    return makeRequest(
      `${NETMIRROR_BASE}search.php?s=${encodeURIComponent(query)}&t=${getUnixTime()}`,
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
      console.log(`[NetMirror-Netflix] Found ${searchData.searchResult.length} results`);
      return searchData.searchResult.map((item) => ({
        id: item.id,
        title: item.t,
        platform: PLATFORM,
        posterUrl: `https://imgcdn.media/poster/v/${item.id}.jpg`
      }));
    } else {
      console.log("[NetMirror-Netflix] No results found");
      return [];
    }
  });
}

// Netflix-specific episode loading
function getEpisodesFromSeason(seriesId, seasonId, page = 1) {
  console.log(`[NetMirror-Netflix] Loading episodes for season ${seasonId}, page ${page}`);
  return bypass().then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "user_token": "233123f803cf02184bf6c67e149cdd50",
      "ott": OTT,
      "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    return makeRequest(
      `${NETMIRROR_BASE}episodes.php?s=${seasonId}&series=${seriesId}&t=${getUnixTime()}&page=${page}`,
      {
        headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
          "Cookie": cookieString,
          "Referer": `${NETMIRROR_BASE}tv/home`
        })
      }
    );
  }).then(function(response) {
    return response.json();
  }).then(function(episodeData) {
    const episodes = episodeData.episodes || [];
    
    // Check if there are more pages
    if (episodeData.nextPageShow === 1) {
      return getEpisodesFromSeason(seriesId, seasonId, page + 1).then(function(nextPageEpisodes) {
        return episodes.concat(nextPageEpisodes);
      });
    }
    
    return episodes;
  }).catch(function(error) {
    console.log(`[NetMirror-Netflix] Failed to load episodes from season ${seasonId}, page ${page}`);
    return [];
  });
}

// Enhanced loadContent function for Netflix
function loadContent(contentId) {
  console.log(`[NetMirror-Netflix] Loading content details for ID: ${contentId}`);
  return bypass().then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "user_token": "233123f803cf02184bf6c67e149cdd50",
      "ott": OTT,
      "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    return makeRequest(
      `${NETMIRROR_BASE}post.php?id=${contentId}&t=${getUnixTime()}`,
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
    console.log(`[NetMirror-Netflix] Loaded: ${postData.title}`);
    
    let allEpisodes = postData.episodes || [];
    const isMovie = !postData.episodes || postData.episodes.length === 0 || postData.episodes[0] === null;
    
    if (!isMovie && postData.episodes && postData.episodes.length > 0 && postData.episodes[0] !== null) {
      console.log("[NetMirror-Netflix] Loading episodes from all seasons...");
      
      let episodePromise = Promise.resolve();
      
      // Load next page episodes if available
      if (postData.nextPageShow === 1 && postData.nextPageSeason) {
        episodePromise = episodePromise.then(function() {
          return getEpisodesFromSeason(contentId, postData.nextPageSeason, 2);
        }).then(function(additionalEpisodes) {
          allEpisodes = allEpisodes.concat(additionalEpisodes);
        });
      }
      
      // Load episodes from other seasons
      if (postData.season && postData.season.length > 1) {
        const otherSeasons = postData.season.slice(0, -1);
        otherSeasons.forEach(function(season) {
          episodePromise = episodePromise.then(function() {
            return getEpisodesFromSeason(contentId, season.id, 1);
          }).then(function(seasonEpisodes) {
            allEpisodes = allEpisodes.concat(seasonEpisodes);
          });
        });
      }
      
      return episodePromise.then(function() {
        console.log(`[NetMirror-Netflix] Loaded ${allEpisodes.filter((ep) => ep !== null).length} total episodes`);
        return {
          id: contentId,
          title: postData.title,
          description: postData.desc,
          year: postData.year,
          episodes: allEpisodes.filter(ep => ep !== null),
          seasons: postData.season || [],
          isMovie: false,
          platform: PLATFORM
        };
      });
    }
    
    return {
      id: contentId,
      title: postData.title,
      description: postData.desc,
      year: postData.year,
      episodes: allEpisodes.filter(ep => ep !== null),
      seasons: postData.season || [],
      isMovie: isMovie,
      platform: PLATFORM
    };
  });
}

// Netflix-specific streaming links
function getStreamingLinks(contentId, title) {
  console.log(`[NetMirror-Netflix] Getting streaming links for: ${title}`);
  return bypass().then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "user_token": "233123f803cf02184bf6c67e149cdd50",
      "hd": "on",
      "ott": OTT
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    return makeRequest(
      `${NETMIRROR_BASE}tv/playlist.php?id=${contentId}&t=${encodeURIComponent(title)}&tm=${getUnixTime()}`,
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
      console.log("[NetMirror-Netflix] No streaming links found");
      return { sources: [], subtitles: [] };
    }
    
    const sources = [];
    const subtitles = [];
    
    playlist.forEach((item) => {
      if (item.sources) {
        item.sources.forEach((source) => {
          let fullUrl = source.file;
          
          // Netflix-specific URL fix: remove /tv/ from URLs
          if (fullUrl.includes("/tv/")) {
            fullUrl = fullUrl.replace("/tv/", "/");
          }
          
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
    
    console.log(`[NetMirror-Netflix] Found ${sources.length} streaming sources and ${subtitles.length} subtitle tracks`);
    return { sources, subtitles };
  });
}

// Enhanced getStreams function for Netflix
function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  console.log(`[NetMirror-Netflix] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${seasonNum ? `, S${seasonNum}E${episodeNum}` : ""}`);
  
  const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  
  return makeRequest(tmdbUrl).then(function(tmdbResponse) {
    return tmdbResponse.json();
  }).then(function(tmdbData) {
    const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
    const year = mediaType === "tv" ? (tmdbData.first_air_date || "").substring(0, 4) : (tmdbData.release_date || "").substring(0, 4);
    
    if (!title) {
      throw new Error("Could not extract title from TMDB response");
    }
    
    console.log(`[NetMirror-Netflix] TMDB Info: "${title}" (${year})`);
    
    // Try different search strategies for TV shows
    let searchQuery = title;
    if (mediaType === "tv" && year) {
      // For TV shows, try with year first
      searchQuery = `${title} ${year}`;
    }
    
    return searchContent(searchQuery).then(function(searchResults) {
      if (searchResults.length === 0 && mediaType === "tv") {
        // Fallback to just title
        return searchContent(title);
      }
      return searchResults;
    }).then(function(searchResults) {
      if (searchResults.length === 0) {
        console.log("[NetMirror-Netflix] No content found");
        return [];
      }
      
      // Filter for this platform only
      const platformResults = searchResults.filter(result => result.platform === PLATFORM);
      if (platformResults.length === 0) {
        console.log("[NetMirror-Netflix] No Netflix content found");
        return [];
      }
      
      // Find the most relevant result
      const selectedContent = findMostRelevantResult(platformResults, title, mediaType);
      console.log(`[NetMirror-Netflix] Selected: ${selectedContent.title} (ID: ${selectedContent.id})`);
      
      return loadContent(selectedContent.id).then(function(contentData) {
        if (mediaType === "tv" && contentData.isMovie) {
          console.log("[NetMirror-Netflix] Content is a movie, but we're looking for TV series");
          return [];
        }
        
        let targetContentId = selectedContent.id;
        let episodeTitle = title;
        
        // For TV shows, find the specific episode
        if (mediaType === "tv" && !contentData.isMovie) {
          const validEpisodes = contentData.episodes.filter((ep) => ep !== null);
          console.log(`[NetMirror-Netflix] Found ${validEpisodes.length} valid episodes`);
          
          if (validEpisodes.length > 0) {
            const targetSeason = seasonNum || 1;
            const targetEpisode = episodeNum || 1;
            
            const episodeData = findEpisode(validEpisodes, targetSeason, targetEpisode);
            
            if (episodeData) {
              targetContentId = episodeData.id;
              episodeTitle = episodeData.t || title;
              console.log(`[NetMirror-Netflix] Found episode ID: ${targetContentId} for S${targetSeason}E${targetEpisode}`);
            } else {
              console.log(`[NetMirror-Netflix] Episode S${targetSeason}E${targetEpisode} not found`);
              // Fallback to first episode of the season
              const firstEpisode = findFirstEpisode(validEpisodes, targetSeason);
              if (firstEpisode) {
                targetContentId = firstEpisode.id;
                console.log(`[NetMirror-Netflix] Using first episode ID: ${targetContentId} for season ${targetSeason}`);
              }
            }
          }
        }
        
        return getStreamingLinks(targetContentId, episodeTitle).then(function(streamData) {
          if (!streamData.sources || streamData.sources.length === 0) {
            console.log("[NetMirror-Netflix] No streaming links found");
            return [];
          }
          
          const streams = streamData.sources.map((source) => {
            let quality = extractQuality(source);
            
            let streamTitle = `${title} ${year ? `(${year})` : ""} ${quality}`;
            if (mediaType === "tv") {
              streamTitle += ` S${seasonNum || 1}E${episodeNum || 1}`;
            }
            
            return {
              name: `NetMirror (Netflix)`,
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
          
          // Sort by quality (highest first)
          streams.sort(sortByQuality);
          
          console.log(`[NetMirror-Netflix] Successfully processed ${streams.length} streams`);
          return streams;
        });
      });
    });
  }).catch(function(error) {
    console.error(`[NetMirror-Netflix] Error in getStreams: ${error.message}`);
    return [];
  });
}

// Helper function to find the most relevant search result
function findMostRelevantResult(results, query, mediaType) {
  if (results.length === 1) return results[0];
  
  const queryLower = query.toLowerCase();
  const isTVSearch = mediaType === "tv";
  
  // Score each result
  const scoredResults = results.map(result => {
    const titleLower = result.title.toLowerCase();
    let score = 0;
    
    // Exact match bonus
    if (titleLower === queryLower) score += 100;
    
    // Contains query words
    const queryWords = queryLower.split(/\s+/);
    const titleWords = titleLower.split(/\s+/);
    const matchingWords = queryWords.filter(word => 
      titleWords.some(titleWord => titleWord.includes(word))
    );
    score += matchingWords.length * 10;
    
    // TV series indicators
    if (isTVSearch) {
      const tvIndicators = ["season", "s01", "s1", "series", "tv"];
      if (tvIndicators.some(indicator => titleLower.includes(indicator))) {
        score += 20;
      }
    }
    
    // Movie indicators (penalize for TV searches)
    if (isTVSearch) {
      const movieIndicators = ["movie", "film", "(202", "(201", "(200"];
      if (movieIndicators.some(indicator => titleLower.includes(indicator))) {
        score -= 30;
      }
    }
    
    return { result, score };
  });
  
  // Sort by score (highest first)
  scoredResults.sort((a, b) => b.score - a.score);
  
  return scoredResults[0].result;
}

// Helper function to find episode by season and episode number
function findEpisode(episodes, season, episode) {
  return episodes.find((ep) => {
    let epSeason, epNumber;
    
    if (ep.s && ep.ep) {
      epSeason = parseInt(ep.s.replace("S", ""));
      epNumber = parseInt(ep.ep.replace("E", ""));
    } else if (ep.season && ep.episode) {
      epSeason = parseInt(ep.season);
      epNumber = parseInt(ep.episode);
    } else if (ep.season_number && ep.episode_number) {
      epSeason = parseInt(ep.season_number);
      epNumber = parseInt(ep.episode_number);
    } else {
      return false;
    }
    
    return epSeason === season && epNumber === episode;
  });
}

// Helper function to find first episode of a season
function findFirstEpisode(episodes, season) {
  const seasonEpisodes = episodes.filter(ep => {
    let epSeason;
    
    if (ep.s) {
      epSeason = parseInt(ep.s.replace("S", ""));
    } else if (ep.season) {
      epSeason = parseInt(ep.season);
    } else if (ep.season_number) {
      epSeason = parseInt(ep.season_number);
    } else {
      return false;
    }
    
    return epSeason === season;
  });
  
  // Find episode with lowest episode number
  return seasonEpisodes.reduce((first, current) => {
    let currentNum, firstNum;
    
    if (current.ep) {
      currentNum = parseInt(current.ep.replace("E", ""));
    } else if (current.episode) {
      currentNum = parseInt(current.episode);
    } else if (current.episode_number) {
      currentNum = parseInt(current.episode_number);
    } else {
      return first;
    }
    
    if (!first) return current;
    
    if (first.ep) {
      firstNum = parseInt(first.ep.replace("E", ""));
    } else if (first.episode) {
      firstNum = parseInt(first.episode);
    } else if (first.episode_number) {
      firstNum = parseInt(first.episode_number);
    }
    
    return currentNum < firstNum ? current : first;
  }, null);
}

// Helper function to extract quality from source
function extractQuality(source) {
  let quality = "HD";
  
  const urlQualityMatch = source.url.match(/[?&]q=(\d+p)/i);
  if (urlQualityMatch) {
    quality = urlQualityMatch[1];
  } else if (source.quality) {
    const labelQualityMatch = source.quality.match(/(\d+p)/i);
    if (labelQualityMatch) {
      quality = labelQualityMatch[1];
    } else {
      const normalizedQuality = source.quality.toLowerCase();
      if (normalizedQuality.includes("full hd") || normalizedQuality.includes("1080")) {
        quality = "1080p";
      } else if (normalizedQuality.includes("hd") || normalizedQuality.includes("720")) {
        quality = "720p";
      } else if (normalizedQuality.includes("480")) {
        quality = "480p";
      } else if (normalizedQuality.includes("360")) {
        quality = "360p";
      } else if (normalizedQuality.includes("240")) {
        quality = "240p";
      }
    }
  } else if (source.url.includes("1080p")) {
    quality = "1080p";
  } else if (source.url.includes("720p")) {
    quality = "720p";
  } else if (source.url.includes("480p")) {
    quality = "480p";
  }
  
  return quality;
}

// Helper function to sort streams by quality
function sortByQuality(a, b) {
  // "auto" quality goes first
  if (a.quality.toLowerCase() === "auto" && b.quality.toLowerCase() !== "auto") return -1;
  if (b.quality.toLowerCase() === "auto" && a.quality.toLowerCase() !== "auto") return 1;
  
  // Parse quality numbers
  const parseQuality = (quality) => {
    const match = quality.match(/(\d{3,4})p/i);
    return match ? parseInt(match[1], 10) : 0;
  };
  
  const qualityA = parseQuality(a.quality);
  const qualityB = parseQuality(b.quality);
  
  // Higher quality first
  return qualityB - qualityA;
}

// Export Netflix-specific functions
if (typeof module !== "undefined" && module.exports) {
  module.exports = { 
    getStreams,
    searchContent,
    loadContent,
    getStreamingLinks,
    getEpisodesFromSeason,
    platform: PLATFORM
  };
} else {
  window.NetMirrorNetflix = { 
    getStreams,
    searchContent,
    loadContent,
    getStreamingLinks,
    getEpisodesFromSeason,
    platform: PLATFORM
  };
}
