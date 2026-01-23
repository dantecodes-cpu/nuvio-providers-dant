function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  console.log(`[NetMirror] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${seasonNum ? `, S${seasonNum}E${episodeNum}` : ""}`);
  const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  return makeRequest(tmdbUrl).then(function(tmdbResponse) {
    return tmdbResponse.json();
  }).then(function(tmdbData) {
    var _a, _b;
    const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
    const year = mediaType === "tv" ? (_a = tmdbData.first_air_date) == null ? void 0 : _a.substring(0, 4) : (_b = tmdbData.release_date) == null ? void 0 : _b.substring(0, 4);
    if (!title) {
      throw new Error("Could not extract title from TMDB response");
    }
    console.log(`[NetMirror] TMDB Info: "${title}" (${year})`);
    
    // Try different search strategies based on media type
    let searchStrategies = [];
    
    if (mediaType === "tv") {
      // For TV shows, try multiple strategies to find the right one
      searchStrategies = [
        { query: title, desc: "Title only" },
        { query: `${title} ${year}`, desc: "Title with year" },
        { query: `${title} season 1`, desc: "Title with season" },
        { query: `${title} s01`, desc: "Title with season number" }
      ];
    } else {
      // For movies, simpler approach
      searchStrategies = [
        { query: title, desc: "Title only" },
        { query: `${title} ${year}`, desc: "Title with year" }
      ];
    }
    
    let platforms = ["netflix", "primevideo", "disney"];
    if (title.toLowerCase().includes("boys") || title.toLowerCase().includes("prime")) {
      platforms = ["primevideo", "netflix", "disney"];
    }
    
    console.log(`[NetMirror] Will try ${searchStrategies.length} search strategies`);
    
    // Improved similarity calculation - simpler but effective
    function calculateSimilarity(str1, str2) {
      const s1 = str1.toLowerCase().trim();
      const s2 = str2.toLowerCase().trim();
      
      // Exact match is best
      if (s1 === s2) return 1;
      
      // Word-based matching
      const words1 = s1.split(/[\s\-.,:;()]+/).filter((w) => w.length > 0);
      const words2 = s2.split(/[\s\-.,:;()]+/).filter((w) => w.length > 0);
      
      let exactMatches = 0;
      for (const queryWord of words2) {
        if (words1.includes(queryWord)) {
          exactMatches++;
        }
      }
      
      // Calculate match percentage
      return exactMatches / Math.max(words1.length, words2.length);
    }
    
    function filterRelevantResults(searchResults, query) {
      const filtered = searchResults.filter((result) => {
        const similarity = calculateSimilarity(result.title, query);
        return similarity >= 0.4; // Lower threshold to catch more results
      });
      
      return filtered.sort((a, b) => {
        const simA = calculateSimilarity(a.title, query);
        const simB = calculateSimilarity(b.title, query);
        return simB - simA;
      });
    }
    
    function tryPlatform(platformIndex) {
      if (platformIndex >= platforms.length) {
        console.log("[NetMirror] No content found on any platform");
        return [];
      }
      const platform = platforms[platformIndex];
      console.log(`[NetMirror] Trying platform: ${platform}`);
      
      function trySearch(strategyIndex) {
        if (strategyIndex >= searchStrategies.length) {
          console.log(`[NetMirror] All search strategies exhausted for ${platform}`);
          return null;
        }
        
        const strategy = searchStrategies[strategyIndex];
        console.log(`[NetMirror] Strategy ${strategyIndex + 1}/${searchStrategies.length}: "${strategy.query}" (${strategy.desc})`);
        
        return searchContent(strategy.query, platform).then(function(searchResults) {
          if (searchResults.length === 0) {
            console.log(`[NetMirror] No results, trying next strategy...`);
            return trySearch(strategyIndex + 1);
          }
          
          const relevantResults = filterRelevantResults(searchResults, title);
          if (relevantResults.length === 0) {
            console.log(`[NetMirror] Found ${searchResults.length} results but none were relevant enough, trying next strategy...`);
            return trySearch(strategyIndex + 1);
          }
          
          // For TV shows, try to filter out movies
          let filteredResults = relevantResults;
          if (mediaType === "tv") {
            filteredResults = relevantResults.filter(result => {
              const lowerTitle = result.title.toLowerCase();
              // Skip results that look like movies
              const movieIndicators = ["(202", "(201", "(200", "(199", "(198"];
              if (movieIndicators.some(indicator => lowerTitle.includes(indicator))) {
                // Check if it's actually a TV series by looking for season indicators
                const seasonIndicators = ["season", "s01", "s1", "s02", "s2", "series"];
                if (!seasonIndicators.some(indicator => lowerTitle.includes(indicator))) {
                  console.log(`[NetMirror] Skipping movie result: ${result.title}`);
                  return false;
                }
              }
              return true;
            });
            
            if (filteredResults.length === 0) {
              console.log(`[NetMirror] All results filtered out as movies, trying next strategy...`);
              return trySearch(strategyIndex + 1);
            }
          }
          
          const selectedContent = filteredResults[0];
          console.log(`[NetMirror] Selected: ${selectedContent.title} (ID: ${selectedContent.id}) - from ${filteredResults.length} filtered results`);
          
          return loadContent(selectedContent.id, platform).then(function(contentData) {
            // Verify content type matches (but be less strict)
            if (mediaType === "tv") {
              // Check if it has episodes/seasons
              if (contentData.isMovie && contentData.seasons.length === 0) {
                console.log(`[NetMirror] Selected content appears to be a movie, trying next strategy...`);
                return trySearch(strategyIndex + 1);
              }
            }
            
            let targetContentId = selectedContent.id;
            let episodeData = null;
            
            if (mediaType === "tv" && !contentData.isMovie) {
              const validEpisodes = contentData.episodes.filter((ep) => ep !== null);
              episodeData = validEpisodes.find((ep) => {
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
                }
                return epSeason === (seasonNum || 1) && epNumber === (episodeNum || 1);
              });
              
              if (episodeData) {
                targetContentId = episodeData.id;
                console.log(`[NetMirror] Found episode ID: ${episodeData.id}`);
              } else {
                console.log(`[NetMirror] Episode S${seasonNum}E${episodeNum} not found, trying next strategy...`);
                return trySearch(strategyIndex + 1);
              }
            }
            
            return getStreamingLinks(targetContentId, title, platform).then(function(streamData) {
              if (!streamData.sources || streamData.sources.length === 0) {
                console.log(`[NetMirror] No streaming links found, trying next strategy...`);
                return trySearch(strategyIndex + 1);
              }
              
              // Debug: Log all source details
              console.log(`[NetMirror] Raw source data:`, streamData.sources.map(s => ({
                url: s.url.substring(0, 100) + "...",
                quality: s.quality,
                type: s.type
              })));
              
              const streams = streamData.sources.map((source) => {
                let quality = "HD";
                const url = source.url;
                const sourceQuality = source.quality || "";
                
                console.log(`[NetMirror] Processing source - URL: ${url.substring(0, 100)}..., Label: "${sourceQuality}"`);
                
                // 🔧 IMPROVED QUALITY DETECTION - Cloudstream approach
                // Try multiple detection methods in order of priority
                
                // Method 1: Direct quality label from source
                if (sourceQuality) {
                  const label = sourceQuality.toLowerCase().trim();
                  console.log(`[NetMirror] Source label: "${label}"`);
                  
                  // Common quality patterns in labels
                  const qualityPatterns = [
                    { pattern: /1080|full.?hd|fhd/i, value: "1080p" },
                    { pattern: /720|hd|high.?def/i, value: "720p" },
                    { pattern: /480|sd|standard.?def/i, value: "480p" },
                    { pattern: /360|low/i, value: "360p" },
                    { pattern: /240|very.?low/i, value: "240p" },
                    { pattern: /(\d{3,4})[pP]/, value: (match) => match[1] + "p" }
                  ];
                  
                  for (const { pattern, value } of qualityPatterns) {
                    const match = label.match(pattern);
                    if (match) {
                      quality = typeof value === 'function' ? value(match) : value;
                      console.log(`[NetMirror] Detected from label: ${quality}`);
                      break;
                    }
                  }
                }
                
                // Method 2: URL pattern matching (most reliable for NetMirror)
                if (quality === "HD" || quality === "720p") {
                  const urlLower = url.toLowerCase();
                  
                  // NetMirror specific patterns
                  const urlPatterns = [
                    // 1080p patterns
                    { pattern: /1080|1920x1080|fullhd|fhd/, value: "1080p" },
                    // 720p patterns  
                    { pattern: /720|1280x720|hd/, value: "720p" },
                    // 480p patterns
                    { pattern: /480|854x480|sd/, value: "480p" },
                    // 360p patterns
                    { pattern: /360|640x360/, value: "360p" },
                    // 240p patterns
                    { pattern: /240|426x240/, value: "240p" }
                  ];
                  
                  for (const { pattern, value } of urlPatterns) {
                    if (pattern.test(urlLower)) {
                      // Additional check to avoid false positives
                      if (value === "1080p" && !urlLower.includes("720") && !urlLower.includes("480") && !urlLower.includes("360")) {
                        quality = value;
                        console.log(`[NetMirror] Detected from URL pattern: ${quality}`);
                        break;
                      } else if (value !== "1080p") {
                        quality = value;
                        console.log(`[NetMirror] Detected from URL pattern: ${quality}`);
                        break;
                      }
                    }
                  }
                }
                
                // Method 3: Query parameter detection
                if (quality === "HD" || quality === "720p") {
                  const urlParams = new URLSearchParams(url.split('?')[1] || '');
                  const qParam = urlParams.get('q') || urlParams.get('quality') || urlParams.get('res');
                  if (qParam) {
                    const qMatch = qParam.match(/(\d{3,4})[pP]?/);
                    if (qMatch) {
                      const num = qMatch[1];
                      if (num === '1080') quality = "1080p";
                      else if (num === '720') quality = "720p";
                      else if (num === '480') quality = "480p";
                      else if (num === '360') quality = "360p";
                      else if (num === '240') quality = "240p";
                      console.log(`[NetMirror] Detected from query param: ${quality}`);
                    }
                  }
                }
                
                // Method 4: File name analysis
                if (quality === "HD" || quality === "720p") {
                  const fileName = url.split('/').pop().split('?')[0].toLowerCase();
                  const qualityInName = fileName.match(/(\d{3,4})[pP]/);
                  if (qualityInName) {
                    const num = qualityInName[1];
                    if (num === '1080') quality = "1080p";
                    else if (num === '720') quality = "720p";
                    else if (num === '480') quality = "480p";
                    else if (num === '360') quality = "360p";
                    console.log(`[NetMirror] Detected from filename: ${quality}`);
                  }
                }
                
                // Method 5: Check for specific NetMirror patterns
                if (quality === "HD" || quality === "720p") {
                  // NetMirror often uses patterns like: /hls/1080/ or /hls/720/
                  if (url.includes('/hls/1080/') || url.includes('/1080/hls/')) {
                    quality = "1080p";
                    console.log(`[NetMirror] Detected from hls path: ${quality}`);
                  } else if (url.includes('/hls/720/') || url.includes('/720/hls/')) {
                    quality = "720p";
                    console.log(`[NetMirror] Detected from hls path: ${quality}`);
                  }
                }
                
                // Method 6: Default based on platform
                if (quality === "HD") {
                  // If we still have HD, check if URL looks like it might be 1080p
                  const urlLower = url.toLowerCase();
                  const hasHighQualityIndicators = urlLower.includes('high') || 
                                                   urlLower.includes('best') || 
                                                   urlLower.includes('quality') ||
                                                   url.includes('1080');
                  
                  const hasLowQualityIndicators = urlLower.includes('low') || 
                                                  urlLower.includes('mobile') ||
                                                  urlLower.includes('360');
                  
                  if (hasHighQualityIndicators && !hasLowQualityIndicators) {
                    quality = "1080p";
                    console.log(`[NetMirror] Defaulted to 1080p based on URL indicators`);
                  } else {
                    quality = "720p";
                    console.log(`[NetMirror] Defaulted to 720p`);
                  }
                }
                
                console.log(`[NetMirror] Final quality: ${quality} for URL`);
                
                let streamTitle = `${title} ${year ? `(${year})` : ""} ${quality}`;
                if (mediaType === "tv") {
                  const episodeName = episodeData && episodeData.t ? episodeData.t : "";
                  streamTitle += ` S${seasonNum}E${episodeNum}`;
                  if (episodeName) {
                    streamTitle += ` - ${episodeName}`;
                  }
                }
                
                // ✅ Correct headers - ALWAYS include Referer (Cloudstream behavior)
                const streamHeaders = {
                  "User-Agent": "Mozilla/5.0 (Linux; Android 13)",
                  "Accept": "*/*",
                  "Referer": "https://net51.cc/"
                };
                
                return {
                  name: `NetMirror (${platform.charAt(0).toUpperCase() + platform.slice(1)})`,
                  title: streamTitle,
                  url: source.url,
                  quality,
                  type: source.type.includes("mpegURL") ? "hls" : "direct",
                  headers: streamHeaders
                };
              });
              
              // Log summary of detected qualities
              const qualityCounts = {};
              streams.forEach(s => {
                qualityCounts[s.quality] = (qualityCounts[s.quality] || 0) + 1;
              });
              console.log(`[NetMirror] Quality summary:`, qualityCounts);
              
              streams.sort((a, b) => {
                if (a.quality.toLowerCase() === "auto" && b.quality.toLowerCase() !== "auto") {
                  return -1;
                }
                if (b.quality.toLowerCase() === "auto" && a.quality.toLowerCase() !== "auto") {
                  return 1;
                }
                const parseQuality = (quality) => {
                  const match = quality.match(/(\d{3,4})p/i);
                  return match ? parseInt(match[1], 10) : 0;
                };
                const qualityA = parseQuality(a.quality);
                const qualityB = parseQuality(b.quality);
                return qualityB - qualityA;
              });
              
              console.log(`[NetMirror] Successfully processed ${streams.length} streams from ${platform}`);
              return streams;
            });
          });
        });
      }
      
      return trySearch(0).then(function(result) {
        if (result) {
          return result;
        } else {
          console.log(`[NetMirror] No content found on ${platform}, trying next platform`);
          return tryPlatform(platformIndex + 1);
        }
      }).catch(function(error) {
        console.log(`[NetMirror] Error on ${platform}: ${error.message}, trying next platform`);
        return tryPlatform(platformIndex + 1);
      });
    }
    
    return tryPlatform(0);
  }).catch(function(error) {
    console.error(`[NetMirror] Error in getStreams: ${error.message}`);
    return [];
  });
}
