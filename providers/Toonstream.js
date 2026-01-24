console.log("[Toonstream] Initializing Toonstream provider");

const BASE_URL = "https://toonstream.one";
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
  "Accept": "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": BASE_URL
};

async function makeRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) },
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  return response;
}

/* ---------------- SIMPLE SEARCH ---------------- */

async function searchToonstream(query) {
  try {
    const url = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
    const response = await makeRequest(url);
    const html = await response.text();
    
    // Simple regex parsing (no DOM)
    const results = [];
    
    // Look for article patterns
    const articleRegex = /<article[\s\S]*?<\/article>/g;
    const articles = html.match(articleRegex) || [];
    
    for (const article of articles) {
      // Extract title
      const titleMatch = article.match(/<h2[^>]*>([^<]+)<\/h2>/);
      if (!titleMatch) continue;
      
      const title = titleMatch[1]
        .replace(/Watch Online/gi, "")
        .trim();
      
      // Extract URL
      const urlMatch = article.match(/href="([^"]+)"/);
      if (!urlMatch) continue;
      
      const url = urlMatch[1];
      
      // Extract poster
      let poster = null;
      const posterMatch = article.match(/src="([^"]+)"/);
      if (posterMatch) {
        poster = posterMatch[1].startsWith('http') ? posterMatch[1] : `https:${posterMatch[1]}`;
      }
      
      results.push({ title, url, poster });
    }
    
    return results;
  } catch (error) {
    console.error(`[Toonstream] Search error:`, error.message);
    return [];
  }
}

/* ---------------- EXTRACT IFRAME LINKS (Like Cloudstream does) ---------------- */

async function extractIframeLinks(pageUrl) {
  try {
    const response = await makeRequest(pageUrl);
    const html = await response.text();
    
    const streams = [];
    
    // Look for iframe tags with data-src (exactly like Cloudstream does)
    const iframeRegex = /<iframe[^>]*data-src="([^"]+)"[^>]*>/g;
    let match;
    
    while ((match = iframeRegex.exec(html)) !== null) {
      const serverlink = match[1];
      console.log(`[Toonstream] Found iframe: ${serverlink}`);
      
      // Follow the iframe to get the actual embed URL (like Cloudstream does)
      try {
        const iframeResponse = await makeRequest(serverlink, {
          headers: { Referer: BASE_URL }
        });
        
        const iframeHtml = await iframeResponse.text();
        
        // Look for the actual iframe src inside
        const srcRegex = /<iframe[^>]*src="([^"]+)"[^>]*>/;
        const srcMatch = iframeHtml.match(srcRegex);
        
        if (srcMatch && srcMatch[1]) {
          const truelink = srcMatch[1];
          console.log(`[Toonstream] Found embed URL: ${truelink}`);
          
          // Return the embed URL - Cloudstream's extractors will handle it
          streams.push({
            name: "Toonstream",
            title: "Toonstream Player",
            url: truelink,
            type: "iframe",
            headers: {
              "User-Agent": HEADERS["User-Agent"],
              "Referer": serverlink
            }
          });
        } else {
          // If no iframe found, maybe it's a direct video page
          // Check for direct video URLs
          const videoPatterns = [
            /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi,
            /(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/gi
          ];
          
          for (const pattern of videoPatterns) {
            const matches = iframeHtml.match(pattern);
            if (matches) {
              matches.forEach(url => {
                if (url.includes('.m3u8') || url.includes('.mp4')) {
                  streams.push({
                    name: "Direct Video",
                    title: "Direct Video",
                    url: url,
                    type: url.includes('.m3u8') ? "hls" : "direct",
                    headers: {
                      "User-Agent": HEADERS["User-Agent"],
                      "Referer": serverlink
                    }
                  });
                }
              });
            }
          }
        }
      } catch (iframeError) {
        console.error(`[Toonstream] Iframe error:`, iframeError.message);
      }
    }
    
    return streams;
  } catch (error) {
    console.error(`[Toonstream] Extraction error:`, error.message);
    return [];
  }
}

/* ---------------- GET TMDB TITLE ---------------- */

async function getTmdbTitle(tmdbId, mediaType) {
  try {
    const url = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    
    return {
      title: mediaType === "tv" ? data.name : data.title,
      year: mediaType === "tv" ? 
        (data.first_air_date || "").substring(0, 4) : 
        (data.release_date || "").substring(0, 4)
    };
  } catch (error) {
    return { title: "", year: null };
  }
}

/* ---------------- MAIN FUNCTION ---------------- */

async function getStreams(tmdbId, mediaType = "movie", seasonNum = 1, episodeNum = 1) {
  console.log(`[Toonstream] Fetching for TMDB: ${tmdbId}, Type: ${mediaType}`);
  
  try {
    // Get title from TMDB
    const { title, year } = await getTmdbTitle(tmdbId, mediaType);
    if (!title) {
      console.log(`[Toonstream] No title from TMDB`);
      return [];
    }
    
    console.log(`[Toonstream] Searching for: "${title}"`);
    
    // Search on Toonstream
    const searchResults = await searchToonstream(title);
    if (searchResults.length === 0) {
      // Try with year
      const searchResults2 = await searchToonstream(`${title} ${year}`);
      if (searchResults2.length === 0) {
        console.log(`[Toonstream] No results found`);
        return [];
      }
      return extractIframeLinks(searchResults2[0].url);
    }
    
    console.log(`[Toonstream] Found ${searchResults.length} results`);
    
    // Use first result
    const selected = searchResults[0];
    console.log(`[Toonstream] Selected: "${selected.title}"`);
    
    // Extract iframe links
    return await extractIframeLinks(selected.url);
    
  } catch (error) {
    console.error(`[Toonstream] Error:`, error.message);
    return [];
  }
}

/* ---------------- TEST FUNCTION ---------------- */

async function test() {
  console.log("[Toonstream] Testing provider...");
  
  // Test with a popular cartoon
  const streams = await getStreams(60574, "tv", 1, 1); // Rick and Morty
  
  if (streams.length === 0) {
    console.log("[Toonstream] No streams found, testing direct search...");
    
    // Test direct search
    const testResults = await searchToonstream("Rick and Morty");
    console.log(`[Toonstream] Direct search results: ${testResults.length}`);
    
    if (testResults.length > 0) {
      console.log(`[Toonstream] First result: ${testResults[0].title}`);
      const testStreams = await extractIframeLinks(testResults[0].url);
      console.log(`[Toonstream] Extracted streams: ${testStreams.length}`);
      
      if (testStreams.length > 0) {
        console.log("[Toonstream] Sample stream:");
        console.log(testStreams[0]);
      }
    }
  } else {
    console.log(`[Toonstream] Found ${streams.length} streams`);
    streams.forEach((stream, i) => {
      console.log(`[Toonstream] Stream ${i + 1}: ${stream.name} - ${stream.url.substring(0, 100)}...`);
    });
  }
}

/* ---------------- EXPORT ---------------- */

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams, test };
  
  // Auto-test when run directly
  if (require.main === module) {
    test();
  }
} else {
  global.getStreams = getStreams;
}
