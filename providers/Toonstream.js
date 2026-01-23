// Enhanced getStreams function for PrimeVideo with Cinemeta fix
function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  console.log(`[NetMirror-PrimeVideo] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${seasonNum ? `, S${seasonNum}E${episodeNum}` : ""}`);
  
  // First try with TMDB API
  const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  
  return makeRequest(tmdbUrl).then(function(tmdbResponse) {
    return tmdbResponse.json();
  }).then(function(tmdbData) {
    const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
    const year = mediaType === "tv" ? (tmdbData.first_air_date || "").substring(0, 4) : (tmdbData.release_date || "").substring(0, 4);
    const originalTitle = tmdbData.original_title || tmdbData.original_name || title;
    
    if (!title) {
      throw new Error("Could not extract title from TMDB response");
    }
    
    console.log(`[NetMirror-PrimeVideo] TMDB Info: "${title}" (${year}), Original: "${originalTitle}"`);
    
    // Special handling for known problematic shows
    const specialHandling = getSpecialHandling(title, tmdbId);
    if (specialHandling) {
      console.log(`[NetMirror-PrimeVideo] Applying special handling for "${title}"`);
      return searchAndLoadSpecial(title, year, mediaType, seasonNum, episodeNum, specialHandling);
    }
    
    // For PrimeVideo, try multiple search strategies
    const searchStrategies = getSearchStrategies(title, year, mediaType, originalTitle);
    
    // Try each search strategy until we find results
    return trySearchStrategies(searchStrategies, 0).then(function(searchResults) {
      if (!searchResults || searchResults.length === 0) {
        console.log("[NetMirror-PrimeVideo] No content found after trying all strategies");
        
        // Fallback: Try direct search without TMDB matching
        return directTitleSearch(title, mediaType, seasonNum, episodeNum);
      }
      
      // Filter for this platform only
      const platformResults = searchResults.filter(result => result.platform === PLATFORM);
      if (platformResults.length === 0) {
        console.log("[NetMirror-PrimeVideo] No PrimeVideo content found in filtered results");
        return directTitleSearch(title, mediaType, seasonNum, episodeNum);
      }
      
      // Find the most relevant result
      const selectedContent = findMostRelevantResult(platformResults, title, mediaType, year);
      console.log(`[NetMirror-PrimeVideo] Selected: ${selectedContent.title} (ID: ${selectedContent.id})`);
      
      return loadContent(selectedContent.id).then(function(contentData) {
        if (mediaType === "tv" && contentData.isMovie) {
          console.log("[NetMirror-PrimeVideo] Content is a movie, but we're looking for TV series");
          return directTitleSearch(title, mediaType, seasonNum, episodeNum);
        }
        
        return processContentForStreaming(contentData, title, mediaType, seasonNum, episodeNum, year);
      });
    });
  }).catch(function(error) {
    console.error(`[NetMirror-PrimeVideo] TMDB error: ${error.message}, trying direct search...`);
    // Fallback to direct search if TMDB fails
    return directTitleSearch("The Boys", "tv", seasonNum, episodeNum);
  });
}

// Helper: Special handling for problematic shows
function getSpecialHandling(title, tmdbId) {
  const titleLower = title.toLowerCase();
  
  // Known problematic shows on PrimeVideo
  const specialCases = {
    "the boys": {
      searchTerms: [
        "The Boys", 
        "The Boys Season", 
        "The Boys S01",
        "The Boys Amazon",
        "The Boys TV Series"
      ],
      isTV: true,
      year: "2019"
    },
    "jack ryan": {
      searchTerms: [
        "Jack Ryan",
        "Tom Clancy's Jack Ryan",
        "Jack Ryan Season"
      ],
      isTV: true,
      year: "2018"
    },
    "the marvelous mrs. maisel": {
      searchTerms: [
        "The Marvelous Mrs. Maisel",
        "Marvelous Mrs Maisel",
        "Mrs Maisel"
      ],
      isTV: true,
      year: "2017"
    },
    "upload": {
      searchTerms: [
        "Upload",
        "Upload Season",
        "Upload Amazon"
      ],
      isTV: true,
      year: "2020"
    },
    "invincible": {
      searchTerms: [
        "Invincible",
        "Invincible Season",
        "Invincible Amazon"
      ],
      isTV: true,
      year: "2021"
    },
    "reacher": {
      searchTerms: [
        "Reacher",
        "Jack Reacher",
        "Reacher Season"
      ],
      isTV: true,
      year: "2022"
    }
  };
  
  for (const [key, value] of Object.entries(specialCases)) {
    if (titleLower.includes(key)) {
      return value;
    }
  }
  
  return null;
}

// Helper: Special search and load for problematic shows
function searchAndLoadSpecial(title, year, mediaType, seasonNum, episodeNum, specialHandling) {
  const searchTerms = specialHandling.searchTerms;
  
  function trySpecialSearch(index) {
    if (index >= searchTerms.length) {
      console.log("[NetMirror-PrimeVideo] All special searches failed");
      return Promise.resolve([]);
    }
    
    const searchQuery = searchTerms[index];
    console.log(`[NetMirror-PrimeVideo] Special search ${index + 1}/${searchTerms.length}: "${searchQuery}"`);
    
    return searchContent(searchQuery).then(function(searchResults) {
      if (searchResults.length === 0) {
        return trySpecialSearch(index + 1);
      }
      
      // Filter for PrimeVideo only
      const platformResults = searchResults.filter(result => result.platform === PLATFORM);
      if (platformResults.length === 0) {
        return trySpecialSearch(index + 1);
      }
      
      // Get the first result (special searches are specific)
      const selectedContent = platformResults[0];
      console.log(`[NetMirror-PrimeVideo] Special match: ${selectedContent.title} (ID: ${selectedContent.id})`);
      
      return loadContent(selectedContent.id).then(function(contentData) {
        if (mediaType === "tv" && contentData.isMovie) {
          console.log("[NetMirror-PrimeVideo] Special content is a movie, trying next term");
          return trySpecialSearch(index + 1);
        }
        
        return processContentForStreaming(contentData, title, mediaType, seasonNum, episodeNum, year || specialHandling.year);
      });
    });
  }
  
  return trySpecialSearch(0);
}

// Helper: Direct title search (bypasses TMDB matching issues)
function directTitleSearch(title, mediaType, seasonNum, episodeNum) {
  console.log(`[NetMirror-PrimeVideo] Direct search for "${title}" (bypassing TMDB)`);
  
  // Try multiple search terms for direct search
  const directSearchTerms = [];
  
  if (mediaType === "tv") {
    // TV show search terms
    directSearchTerms.push(`${title} Season`);
    directSearchTerms.push(`${title} S01`);
    directSearchTerms.push(`${title} TV Series`);
    directSearchTerms.push(`${title} Amazon`);
    directSearchTerms.push(title);
  } else {
    // Movie search terms
    directSearchTerms.push(title);
    directSearchTerms.push(`${title} Movie`);
  }
  
  function tryDirectSearch(index) {
    if (index >= directSearchTerms.length) {
      console.log("[NetMirror-PrimeVideo] All direct searches failed");
      return Promise.resolve([]);
    }
    
    const searchQuery = directSearchTerms[index];
    console.log(`[NetMirror-PrimeVideo] Direct search ${index + 1}/${directSearchTerms.length}: "${searchQuery}"`);
    
    return searchContent(searchQuery).then(function(searchResults) {
      if (searchResults.length === 0) {
        return tryDirectSearch(index + 1);
      }
      
      // Filter for PrimeVideo only
      const platformResults = searchResults.filter(result => result.platform === PLATFORM);
      if (platformResults.length === 0) {
        return tryDirectSearch(index + 1);
      }
      
      // For direct search, we need to be more careful about relevance
      const selectedContent = findBestDirectMatch(platformResults, title, mediaType);
      console.log(`[NetMirror-PrimeVideo] Direct match: ${selectedContent.title} (ID: ${selectedContent.id})`);
      
      return loadContent(selectedContent.id).then(function(contentData) {
        // Verify content type
        if (mediaType === "tv" && contentData.isMovie) {
          console.log("[NetMirror-PrimeVideo] Direct match is a movie, trying next term");
          return tryDirectSearch(index + 1);
        }
        
        // Use a generic year for direct searches
        const estimatedYear = estimateYearFromTitle(selectedContent.title);
        
        return processContentForStreaming(contentData, title, mediaType, seasonNum, episodeNum, estimatedYear);
      });
    });
  }
  
  return tryDirectSearch(0);
}

// Helper: Find best match for direct search
function findBestDirectMatch(results, query, mediaType) {
  if (results.length === 1) return results[0];
  
  const queryLower = query.toLowerCase();
  const isTVSearch = mediaType === "tv";
  
  // Score each result
  const scoredResults = results.map(result => {
    const titleLower = result.title.toLowerCase();
    let score = 0;
    
    // Exact match bonus
    if (titleLower === queryLower) score += 100;
    
    // Contains the main title words
    const queryWords = queryLower.split(/\s+/).filter(word => word.length > 2);
    const titleWords = titleLower.split(/\s+/);
    
    let matchedWords = 0;
    queryWords.forEach(word => {
      if (titleWords.some(titleWord => titleWord.includes(word))) {
        matchedWords++;
      }
    });
    
    score += matchedWords * 15;
    
    // TV series indicators
    if (isTVSearch) {
      const tvIndicators = ["season", "s01", "s1", "s02", "s2", "series", "tv"];
      const hasTVIndicator = tvIndicators.some(indicator => titleLower.includes(indicator));
      
      if (hasTVIndicator) {
        score += 40;
      } else {
        // Penalize if it looks like a movie
        const movieIndicators = ["movie", "film", "(202", "(201", "(200", "(199"];
        if (movieIndicators.some(indicator => titleLower.includes(indicator))) {
          score -= 60;
        }
      }
    }
    
    // Length penalty (very long titles might be compilations)
    if (titleWords.length > 8) {
      score -= 20;
    }
    
    return { result, score };
  });
  
  // Sort by score
  scoredResults.sort((a, b) => b.score - a.score);
  
  // Log top 3 for debugging
  console.log("[NetMirror-PrimeVideo] Direct search top matches:");
  scoredResults.slice(0, 3).forEach((item, i) => {
    console.log(`  ${i + 1}. "${item.result.title}" - Score: ${item.score}`);
  });
  
  return scoredResults[0].result;
}

// Helper: Estimate year from title
function estimateYearFromTitle(title) {
  const yearMatch = title.match(/\((\d{4})\)/);
  if (yearMatch) {
    return yearMatch[1];
  }
  
  // Common years for popular shows
  const knownYears = {
    "the boys": "2019",
    "jack ryan": "2018",
    "the marvelous mrs. maisel": "2017",
    "upload": "2020",
    "invincible": "2021",
    "reacher": "2022"
  };
  
  const titleLower = title.toLowerCase();
  for (const [show, year] of Object.entries(knownYears)) {
    if (titleLower.includes(show)) {
      return year;
    }
  }
  
  return "";
}

// Helper: Process content and get streaming links
function processContentForStreaming(contentData, title, mediaType, seasonNum, episodeNum, year) {
  let targetContentId = contentData.id;
  let episodeTitle = title;
  
  // For TV shows, find the specific episode
  if (mediaType === "tv" && !contentData.isMovie) {
    const validEpisodes = contentData.episodes.filter((ep) => ep !== null);
    console.log(`[NetMirror-PrimeVideo] Found ${validEpisodes.length} valid episodes`);
    
    if (validEpisodes.length > 0) {
      const targetSeason = seasonNum || 1;
      const targetEpisode = episodeNum || 1;
      
      const episodeData = findEpisode(validEpisodes, targetSeason, targetEpisode);
      
      if (episodeData) {
        targetContentId = episodeData.id;
        episodeTitle = episodeData.t || title;
        console.log(`[NetMirror-PrimeVideo] Found episode ID: ${targetContentId} for S${targetSeason}E${targetEpisode}`);
      } else {
        console.log(`[NetMirror-PrimeVideo] Episode S${targetSeason}E${targetEpisode} not found`);
        // Fallback to first episode of the season
        const firstEpisode = findFirstEpisode(validEpisodes, targetSeason);
        if (firstEpisode) {
          targetContentId = firstEpisode.id;
          episodeNum = firstEpisode.ep ? parseInt(firstEpisode.ep.replace("E", "")) : 1;
          console.log(`[NetMirror-PrimeVideo] Using first episode ID: ${targetContentId} for season ${targetSeason}`);
        }
      }
    }
  }
  
  return getStreamingLinks(targetContentId, episodeTitle).then(function(streamData) {
    if (!streamData.sources || streamData.sources.length === 0) {
      console.log("[NetMirror-PrimeVideo] No streaming links found");
      return [];
    }
    
    const streams = streamData.sources.map((source) => {
      let quality = extractQuality(source);
      
      let streamTitle = `${title} ${year ? `(${year})` : ""} ${quality}`;
      if (mediaType === "tv") {
        streamTitle += ` S${seasonNum || 1}E${episodeNum || 1}`;
      }
      
      return {
        name: `NetMirror (PrimeVideo)`,
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
    
    console.log(`[NetMirror-PrimeVideo] Successfully processed ${streams.length} streams`);
    return streams;
  });
}

// Update getSearchStrategies to include original title
function getSearchStrategies(title, year, mediaType, originalTitle) {
  const strategies = [];
  
  if (mediaType === "tv") {
    // For TV shows, try multiple strategies
    if (year) {
      strategies.push(`${title} ${year}`); // Title + year
      strategies.push(`${title} season 1 ${year}`); // Title + season + year
      strategies.push(`${title} s01 ${year}`); // Title + s01 + year
    }
    
    strategies.push(`${title} season 1`); // Title + season
    strategies.push(`${title} s01`); // Title + s01
    
    // Try without "The" for some shows
    if (title.startsWith("The ")) {
      const withoutThe = title.substring(4);
      strategies.push(`${withoutThe} season 1`);
      strategies.push(`${withoutThe} s01`);
    }
    
    strategies.push(title); // Just title
    
    // Try original title if different
    if (originalTitle && originalTitle.toLowerCase() !== title.toLowerCase()) {
      strategies.push(originalTitle);
      strategies.push(`${originalTitle} season 1`);
    }
  } else {
    // For movies
    if (year) {
      strategies.push(`${title} ${year}`); // Title + year
    }
    strategies.push(title); // Just title
    
    // Try original title if different
    if (originalTitle && originalTitle.toLowerCase() !== title.toLowerCase()) {
      strategies.push(originalTitle);
    }
  }
  
  return strategies;
}

// Update findMostRelevantResult to consider year
function findMostRelevantResult(results, query, mediaType, year) {
  if (results.length === 1) return results[0];
  
  const queryLower = query.toLowerCase();
  const isTVSearch = mediaType === "tv";
  const yearStr = year ? year.toString() : null;
  
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
        score += 30;
      }
    }
    
    // Year match bonus
    if (yearStr && titleLower.includes(yearStr)) {
      score += 25;
    }
    
    // Movie indicators (penalize for TV searches)
    if (isTVSearch) {
      const movieIndicators = ["movie", "film"];
      if (movieIndicators.some(indicator => titleLower.includes(indicator))) {
        score -= 50;
      }
    }
    
    // The Boys specific handling
    if (queryLower.includes("boys") && isTVSearch) {
      if (titleLower.includes("movie") || titleLower.includes("film")) {
        score -= 100; // Heavy penalty for movie version
      }
      if (titleLower.includes("season") || titleLower.includes("s01")) {
        score += 50; // Big bonus for TV indicators
      }
    }
    
    return { result, score };
  });
  
  // Sort by score
  scoredResults.sort((a, b) => b.score - a.score);
  
  // Log the top results
  console.log("[NetMirror-PrimeVideo] Search result scores:");
  scoredResults.slice(0, 5).forEach((item, i) => {
    console.log(`  ${i + 1}. "${item.result.title}" - Score: ${item.score}`);
  });
  
  return scoredResults[0].result;
}
