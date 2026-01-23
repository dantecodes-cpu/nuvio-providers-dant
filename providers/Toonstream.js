// Add these Netflix-specific functions after the existing functions:

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

// Enhanced loadContent function for Netflix:
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

// Enhanced getStreams function for Netflix:
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
      
      const selectedContent = platformResults[0];
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
            
            const episodeData = validEpisodes.find((ep) => {
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
              return epSeason === targetSeason && epNumber === targetEpisode;
            });
            
            if (episodeData) {
              targetContentId = episodeData.id;
              episodeTitle = episodeData.t || title;
              console.log(`[NetMirror-Netflix] Found episode ID: ${targetContentId} for S${targetSeason}E${targetEpisode}`);
            } else {
              console.log(`[NetMirror-Netflix] Episode S${targetSeason}E${targetEpisode} not found`);
              // Fallback to first episode
              const firstEpisode = validEpisodes.find(ep => {
                let epSeason = ep.s ? parseInt(ep.s.replace("S", "")) : (ep.season || 1);
                return epSeason === (seasonNum || 1);
              });
              if (firstEpisode) {
                targetContentId = firstEpisode.id;
                console.log(`[NetMirror-Netflix] Using first episode ID: ${targetContentId}`);
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
                }
              }
            }
            
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
          
          // Sort by quality
          streams.sort((a, b) => {
            const parseQuality = (quality) => {
              const match = quality.match(/(\d{3,4})p/i);
              return match ? parseInt(match[1], 10) : 0;
            };
            const qualityA = parseQuality(a.quality);
            const qualityB = parseQuality(b.quality);
            return qualityB - qualityA;
          });
          
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
