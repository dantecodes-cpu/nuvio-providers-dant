console.log("[Toonstream] Initializing Toonstream provider");

const BASE_URL = "https://toonstream.one";
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

// Add required Node.js modules
const { JSDOM } = require('jsdom');
const fetch = require('node-fetch');

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Cache-Control": "max-age=0"
};

async function makeRequest(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: { ...HEADERS, ...(options.headers || {}) },
      signal: controller.signal,
      redirect: 'follow'
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout: ${url}`);
    }
    throw error;
  }
}

/* ---------------- TMDB ---------------- */

async function getTmdbTitle(tmdbId, mediaType) {
  try {
    const url = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const response = await makeRequest(url);
    const data = await response.json();
    
    return {
      title: mediaType === "tv" ? data.name : data.title,
      year: mediaType === "tv" ? 
        (data.first_air_date || "").substring(0, 4) : 
        (data.release_date || "").substring(0, 4),
      originalTitle: data.original_title || data.original_name || ""
    };
  } catch (error) {
    console.error(`[Toonstream] TMDB error:`, error.message);
    return { title: "", year: null, originalTitle: "" };
  }
}

/* ---------------- SEARCH ---------------- */

function cleanTitle(title) {
  return title
    .replace(/(Watch\s+Online|Full\s+Movie|Season\s+\d+|S\d+|E\d+|Episode\s+\d+)/gi, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  
  const s1 = cleanTitle(str1).toLowerCase();
  const s2 = cleanTitle(str2).toLowerCase();
  
  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) return 0.9;
  
  const words1 = s1.split(/\s+/).filter(w => w.length > 2);
  const words2 = s2.split(/\s+/).filter(w => w.length > 2);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  let matches = 0;
  for (const word1 of words1) {
    for (const word2 of words2) {
      if (word1 === word2) {
        matches += 2;
        break;
      } else if (word1.includes(word2) || word2.includes(word1)) {
        matches += 1;
        break;
      }
    }
  }
  
  return (matches * 2) / (words1.length + words2.length);
}

async function searchToonstream(query) {
  const results = [];
  
  try {
    const url = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
    console.log(`[Toonstream] Searching: ${url}`);
    
    const response = await makeRequest(url);
    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Try multiple selectors
    const selectors = [
      "#movies-a > ul > li",
      "ul.items li",
      ".movie-list article",
      "article.post"
    ];
    
    let items = [];
    for (const selector of selectors) {
      items = doc.querySelectorAll(selector);
      if (items.length > 0) break;
    }
    
    console.log(`[Toonstream] Found ${items.length} items`);
    
    items.forEach((el, index) => {
      try {
        // Try multiple title selectors
        const titleSelectors = [
          "h2.entry-title",
          "header.entry-header h2",
          "h2",
          ".title",
          "a[rel='bookmark']"
        ];
        
        let titleEl = null;
        for (const selector of titleSelectors) {
          titleEl = el.querySelector(selector);
          if (titleEl && titleEl.textContent.trim()) break;
        }
        
        if (!titleEl) return;
        
        const rawTitle = titleEl.textContent.trim();
        const title = rawTitle
          .replace(/Watch\s+Online/gi, "")
          .trim();
        
        // Find link
        let linkEl = el.querySelector("a");
        if (!linkEl) {
          linkEl = titleEl.closest("a") || titleEl.parentElement.closest("a");
        }
        
        if (!linkEl || !linkEl.href) return;
        
        const href = linkEl.href;
        
        // Find poster
        let poster = null;
        const imgEl = el.querySelector("img");
        if (imgEl) {
          const src = imgEl.src || imgEl.getAttribute("src") || imgEl.getAttribute("data-src");
          if (src) {
            poster = src.startsWith("http") ? src : `https:${src}`;
          }
        }
        
        const similarity = calculateSimilarity(title, query);
        
        if (similarity >= 0.1) { // Very low threshold for cartoons
          results.push({ 
            title, 
            url: href,
            poster,
            similarity,
            rawTitle
          });
        }
        
      } catch (itemError) {
        // Skip this item
      }
    });
    
  } catch (error) {
    console.error(`[Toonstream] Search error:`, error.message);
  }
  
  // Remove duplicates and sort
  const uniqueResults = Array.from(new Map(results.map(item => [item.url, item])).values());
  return uniqueResults.sort((a, b) => b.similarity - a.similarity);
}

/* ---------------- EXTRACT VIDEO LINKS ---------------- */

async function extractVideoLinks(pageUrl) {
  console.log(`[Toonstream] Extracting from: ${pageUrl}`);
  
  try {
    const response = await makeRequest(pageUrl, {
      headers: {
        ...HEADERS,
        "Referer": BASE_URL
      }
    });
    
    const html = await response.text();
    
    // Look for video links in the HTML
    const streams = [];
    
    // Pattern 1: Look for m3u8 URLs
    const m3u8Patterns = [
      /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi,
      /['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/gi,
      /file:\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/gi,
      /source:\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/gi,
      /src:\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/gi
    ];
    
    for (const pattern of m3u8Patterns) {
      const matches = html.match(pattern);
      if (matches) {
        matches.forEach(url => {
          const cleanUrl = url.replace(/['"]/g, '').trim();
          if (cleanUrl.includes('.m3u8') && !streams.some(s => s.url === cleanUrl)) {
            // Extract quality from URL
            let quality = "Unknown";
            if (cleanUrl.includes('1080')) quality = "1080p";
            else if (cleanUrl.includes('720')) quality = "720p";
            else if (cleanUrl.includes('480')) quality = "480p";
            else if (cleanUrl.includes('360')) quality = "360p";
            
            streams.push({
              name: "Toonstream HLS",
              title: `Toonstream HLS (${quality})`,
              url: cleanUrl,
              type: "hls",
              quality: quality,
              headers: {
                "User-Agent": HEADERS["User-Agent"],
                "Referer": pageUrl,
                "Origin": BASE_URL
              }
            });
            console.log(`[Toonstream] Found m3u8: ${cleanUrl.substring(0, 100)}...`);
          }
        });
      }
    }
    
    // Pattern 2: Look for iframe data-src (these often contain the real video)
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    
    // Look for iframes with video players
    const iframes = doc.querySelectorAll("iframe[data-src], iframe[src*='embed'], #aa-options iframe");
    
    for (const iframe of iframes) {
      const src = iframe.getAttribute("data-src") || iframe.getAttribute("src");
      if (src && src.includes('http')) {
        console.log(`[Toonstream] Found iframe: ${src}`);
        
        // Try to extract from common video hosts
        if (src.includes('streamsb') || src.includes('sbplay') || src.includes('sbfast')) {
          // StreamSB - common on Toonstream
          const streamUrl = await extractFromStreamSB(src, pageUrl);
          if (streamUrl) {
            streams.push({
              name: "StreamSB",
              title: "StreamSB",
              url: streamUrl,
              type: "direct",
              quality: "HD",
              headers: {
                "User-Agent": HEADERS["User-Agent"],
                "Referer": src,
                "Origin": new URL(src).origin
              }
            });
          }
        } else if (src.includes('dood') || src.includes('d000d')) {
          // DoodStream
          const streamUrl = await extractFromDoodStream(src, pageUrl);
          if (streamUrl) {
            streams.push({
              name: "DoodStream",
              title: "DoodStream",
              url: streamUrl,
              type: "direct",
              quality: "HD",
              headers: {
                "User-Agent": HEADERS["User-Agent"],
                "Referer": src
              }
            });
          }
        } else {
          // Generic iframe - might contain direct video
          try {
            const iframeResponse = await makeRequest(src, {
              headers: {
                "User-Agent": HEADERS["User-Agent"],
                "Referer": pageUrl
              }
            });
            
            const iframeHtml = await iframeResponse.text();
            
            // Look for video URLs in iframe
            const videoPatterns = [
              /(https?:\/\/[^\s"'<>]+\.(mp4|m3u8|mkv)[^\s"'<>]*)/gi,
              /source\s*:\s*['"](https?:\/\/[^'"]+)['"]/gi,
              /file\s*:\s*['"](https?:\/\/[^'"]+)['"]/gi
            ];
            
            for (const pattern of videoPatterns) {
              const matches = iframeHtml.match(pattern);
              if (matches) {
                matches.forEach(match => {
                  const url = match.replace(/['"]/g, '').trim();
                  if (url && (url.includes('.mp4') || url.includes('.m3u8'))) {
                    let quality = "Unknown";
                    if (url.includes('1080')) quality = "1080p";
                    else if (url.includes('720')) quality = "720p";
                    
                    streams.push({
                      name: "Direct Video",
                      title: `Direct Video (${quality})`,
                      url: url,
                      type: url.includes('.m3u8') ? "hls" : "direct",
                      quality: quality,
                      headers: {
                        "User-Agent": HEADERS["User-Agent"],
                        "Referer": src
                      }
                    });
                  }
                });
              }
            }
          } catch (iframeError) {
            console.log(`[Toonstream] Iframe error: ${iframeError.message}`);
          }
        }
      }
    }
    
    // Pattern 3: Look for Cloudstream-like patterns
    const cloudstreamPatterns = [
      /https?:\/\/[^\/]+\.strmupcdn\.cc\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi,
      /https?:\/\/(?:185\.237\.106\.168|s3-hls3-cdn48\.strmupcdn\.cc)\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi
    ];
    
    for (const pattern of cloudstreamPatterns) {
      const matches = html.match(pattern);
      if (matches) {
        matches.forEach(url => {
          const cleanUrl = url.trim();
          if (!streams.some(s => s.url === cleanUrl)) {
            streams.push({
              name: "Cloudstream CDN",
              title: "Cloudstream CDN",
              url: cleanUrl,
              type: "hls",
              quality: "HD",
              headers: {
                "User-Agent": HEADERS["User-Agent"],
                "Referer": pageUrl,
                "Origin": BASE_URL
              }
            });
            console.log(`[Toonstream] Found Cloudstream URL: ${cleanUrl.substring(0, 80)}...`);
          }
        });
      }
    }
    
    // Pattern 4: Look for AJAX-loaded video data
    const ajaxPatterns = [
      /"url"\s*:\s*"([^"]+\.m3u8[^"]*)"/gi,
      /"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/gi,
      /"src"\s*:\s*"([^"]+\.m3u8[^"]*)"/gi
    ];
    
    for (const pattern of ajaxPatterns) {
      const matches = [...html.matchAll(pattern)];
      for (const match of matches) {
        if (match[1]) {
          const url = match[1].replace(/\\\//g, '/');
          if (url.includes('.m3u8') && !streams.some(s => s.url === url)) {
            streams.push({
              name: "AJAX Video",
              title: "AJAX Video",
              url: url,
              type: "hls",
              quality: "HD",
              headers: {
                "User-Agent": HEADERS["User-Agent"],
                "Referer": pageUrl
              }
            });
          }
        }
      }
    }
    
    // If no streams found, try to find episode iframes
    if (streams.length === 0) {
      const episodeLinks = doc.querySelectorAll("a[href*='episode'], .episode a");
      for (const link of episodeLinks) {
        const href = link.href;
        if (href && href.includes('http')) {
          console.log(`[Toonstream] Trying episode link: ${href}`);
          const episodeStreams = await extractVideoLinks(href);
          streams.push(...episodeStreams);
          if (streams.length > 0) break;
        }
      }
    }
    
    return streams;
    
  } catch (error) {
    console.error(`[Toonstream] Extraction error:`, error.message);
    return [];
  }
}

/* ---------------- EXTRACT FROM STREAMSB ---------------- */

async function extractFromStreamSB(url, referer) {
  try {
    const response = await makeRequest(url, {
      headers: {
        "User-Agent": HEADERS["User-Agent"],
        "Referer": referer
      }
    });
    
    const html = await response.text();
    
    // Look for StreamSB video URLs
    const patterns = [
      /sources:\s*\[\s*\{\s*src:\s*['"]([^'"]+)['"]/,
      /file:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/,
      /"file":"([^"]+\.m3u8[^"]*)"/,
      /(https?:\/\/[^\/]+\.sbplay\.org\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        return match[1].replace(/\\\//g, '/');
      }
    }
    
    return null;
  } catch (error) {
    console.error(`[Toonstream] StreamSB error:`, error.message);
    return null;
  }
}

/* ---------------- EXTRACT FROM DOODSTREAM ---------------- */

async function extractFromDoodStream(url, referer) {
  try {
    const response = await makeRequest(url, {
      headers: {
        "User-Agent": HEADERS["User-Agent"],
        "Referer": referer
      }
    });
    
    const html = await response.text();
    
    // Look for DoodStream pass_md5
    const passMd5Match = html.match(/pass_md5\s*=\s*['"]([^'"]+)['"]/);
    if (passMd5Match) {
      const passMd5 = passMd5Match[1];
      const domain = new URL(url).hostname;
      const tokenMatch = html.match(/\?token=([^&'"\s]+)/);
      const token = tokenMatch ? tokenMatch[1] : '';
      
      // Construct DoodStream video URL
      const videoUrl = `https://${domain}/d/${passMd5}${token ? `?token=${token}` : ''}`;
      return videoUrl;
    }
    
    return null;
  } catch (error) {
    console.error(`[Toonstream] DoodStream error:`, error.message);
    return null;
  }
}

/* ---------------- MAIN FUNCTION ---------------- */

async function getStreams(tmdbId, mediaType = "movie", seasonNum = 1, episodeNum = 1) {
  console.log(`[Toonstream] Fetching streams for TMDB: ${tmdbId}, Type: ${mediaType}${mediaType === "tv" ? ` S${seasonNum}E${episodeNum}` : ""}`);
  
  try {
    // Get title from TMDB
    const { title } = await getTmdbTitle(tmdbId, mediaType);
    if (!title) {
      console.log(`[Toonstream] No title from TMDB`);
      return [];
    }
    
    console.log(`[Toonstream] Searching for: "${title}"`);
    
    // Search on Toonstream
    const searchResults = await searchToonstream(title);
    if (searchResults.length === 0) {
      console.log(`[Toonstream] No search results`);
      return [];
    }
    
    console.log(`[Toonstream] Found ${searchResults.length} results`);
    
    // Use the first result (best match)
    const selected = searchResults[0];
    console.log(`[Toonstream] Selected: "${selected.title}"`);
    
    // Extract video links
    const streams = await extractVideoLinks(selected.url);
    
    if (streams.length === 0) {
      console.log(`[Toonstream] No video links found`);
      return [];
    }
    
    console.log(`[Toonstream] Found ${streams.length} streams`);
    
    // Format streams for Cloudstream
    return streams.map(stream => ({
      name: stream.name,
      title: stream.title,
      url: stream.url,
      type: stream.type,
      quality: stream.quality,
      headers: stream.headers,
      // Cloudstream specific properties
      referer: stream.headers?.Referer || BASE_URL,
      origin: stream.headers?.Origin || BASE_URL
    }));
    
  } catch (error) {
    console.error(`[Toonstream] Error:`, error.message);
    return [];
  }
}

/* ---------------- EXPORT ---------------- */

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
