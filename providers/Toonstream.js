// ToonStream Provider for Nuvio
// Fixed version with proper embed extraction and iframe type

console.log('[ToonStream] Provider initialized');

// Constants
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.one";
const AJAX_URL = "https://toonstream.one/wp-admin/admin-ajax.php";

// Helper: Make HTTP request
function fetchText(url, referer = MAIN_URL) {
    return fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': referer
        }
    })
    .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
    })
    .catch(error => {
        console.error(`[ToonStream] Fetch failed: ${url}`, error.message);
        return null;
    });
}

// Helper: Normalize text for matching
function normalizeText(text) {
    return text.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

// 1. Get TMDB info
function getTMDBInfo(tmdbId, mediaType) {
    console.log(`[ToonStream] Getting TMDB info for ${tmdbId} (${mediaType})`);
    
    const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    
    return fetch(url)
        .then(response => response.ok ? response.json() : null)
        .then(data => {
            if (!data) return null;
            
            return {
                title: mediaType === 'movie' ? data.title : data.name,
                year: mediaType === 'movie' 
                    ? (data.release_date ? data.release_date.substring(0, 4) : null)
                    : (data.first_air_date ? data.first_air_date.substring(0, 4) : null)
            };
        })
        .catch(error => {
            console.error('[ToonStream] TMDB error:', error);
            return null;
        });
}

// 2. Search ToonStream
function searchToonStream(query) {
    console.log('[ToonStream] Searching for:', query);
    
    const searchUrl = `${MAIN_URL}/?s=${encodeURIComponent(query)}`;
    
    return fetchText(searchUrl)
        .then(html => {
            if (!html) return [];
            
            const results = [];
            const searchNormalized = normalizeText(query);
            
            // Parse articles
            const articleRegex = /<article[\s\S]*?<\/article>/gi;
            let articleMatch;
            
            while ((articleMatch = articleRegex.exec(html)) !== null) {
                const articleHtml = articleMatch[0];
                
                // Extract title
                const titleMatch = articleHtml.match(/<h2[^>]*>([^<]+)<\/h2>/i);
                if (!titleMatch) continue;
                
                // Extract URL
                const urlMatch = articleHtml.match(/<a[^>]*href="([^"]+)"/i);
                if (!urlMatch) continue;
                
                const title = titleMatch[1].replace(/Watch Online/gi, '').trim();
                let url = urlMatch[1];
                
                // Fix URL
                if (url.startsWith('//')) url = 'https:' + url;
                else if (url.startsWith('/')) url = MAIN_URL + url;
                
                // Determine type
                const type = url.includes('/series/') ? 'tv' : 'movie';
                
                // Check for good match
                const titleNormalized = normalizeText(title);
                const isGoodMatch = titleNormalized.includes(searchNormalized) || 
                                   searchNormalized.includes(titleNormalized);
                
                if (isGoodMatch) {
                    results.push({
                        title: title,
                        url: url,
                        type: type,
                        score: titleNormalized === searchNormalized ? 2 : 1
                    });
                }
            }
            
            // Sort by best match
            results.sort((a, b) => b.score - a.score);
            
            console.log(`[ToonStream] Found ${results.length} results`);
            return results;
        });
}

// 3. Extract embed URLs (FIXED - includes JS sources)
function extractEmbedUrls(html) {
    console.log('[ToonStream] Extracting embed URLs');
    const embeds = [];
    
    // Pattern 1: iframe with data-src
    const iframeDataSrcRegex = /<iframe[^>]*data-src="([^"]+)"[^>]*>/gi;
    let match;
    
    while ((match = iframeDataSrcRegex.exec(html)) !== null) {
        let url = match[1];
        if (url.startsWith('//')) url = 'https:' + url;
        embeds.push({ url: url, source: 'iframe-data-src' });
    }
    
    // Pattern 2: iframe with src
    const iframeSrcRegex = /<iframe[^>]*src="([^"]+)"[^>]*>/gi;
    while ((match = iframeSrcRegex.exec(html)) !== null) {
        let url = match[1];
        if (url.startsWith('//')) url = 'https:' + url;
        embeds.push({ url: url, source: 'iframe-src' });
    }
    
    // Pattern 3: JavaScript sources array (CRITICAL FIX)
    const sourcesRegex = /sources\s*:\s*(\[[\s\S]*?\])/gi;
    while ((match = sourcesRegex.exec(html)) !== null) {
        try {
            // Clean and parse JSON
            const jsonStr = match[1]
                .replace(/'/g, '"')
                .replace(/(\w+):/g, '"$1":')
                .replace(/,\s*}/g, '}')
                .replace(/,\s*]/g, ']');
            
            const sources = JSON.parse(jsonStr);
            
            for (const source of sources) {
                if (source.file && source.file.includes('http')) {
                    embeds.push({ 
                        url: source.file, 
                        source: 'js-sources',
                        label: source.label || null
                    });
                }
            }
        } catch (e) {
            console.log('[ToonStream] Failed to parse JS sources, trying alternative');
            
            // Alternative: extract direct URLs from the text
            const urlMatches = match[1].match(/(https?:\/\/[^\s"',]+\.(?:m3u8|mp4))/gi);
            if (urlMatches) {
                for (const url of urlMatches) {
                    embeds.push({ url: url, source: 'js-direct' });
                }
            }
        }
    }
    
    // Pattern 4: Direct m3u8/mp4 URLs in script tags
    const scriptRegex = /<script[^>]*>[\s\S]*?(https?:\/\/[^\s"',]+\.(?:m3u8|mp4))[\s\S]*?<\/script>/gi;
    while ((match = scriptRegex.exec(html)) !== null) {
        embeds.push({ url: match[1], source: 'script-tag' });
    }
    
    // Pattern 5: Video player config
    const playerConfigRegex = /playerInstance\.setup\s*\(\s*({[\s\S]*?})\s*\)/gi;
    while ((match = playerConfigRegex.exec(html)) !== null) {
        try {
            const configStr = match[1]
                .replace(/'/g, '"')
                .replace(/(\w+):/g, '"$1":');
            
            const config = JSON.parse(configStr);
            if (config.sources && Array.isArray(config.sources)) {
                for (const source of config.sources) {
                    if (source.file) {
                        embeds.push({ url: source.file, source: 'player-config' });
                    }
                }
            }
        } catch (e) {
            // Skip invalid JSON
        }
    }
    
    // Clean up URLs
    const cleanedEmbeds = [];
    const seenUrls = new Set();
    
    for (const embed of embeds) {
        if (!embed.url || !embed.url.includes('http')) continue;
        
        // Clean AWSStream/Zephyrflick URLs
        let cleanUrl = embed.url;
        
        // Extract hash from AWSStream URLs
        if (embed.url.includes('awstream.net') || embed.url.includes('zephyrflick.top')) {
            const hashMatch = embed.url.match(/embed(?:-4)?\/([a-zA-Z0-9]+)/);
            if (hashMatch) {
                const base = embed.url.includes('zephyrflick.top') 
                    ? 'https://play.zephyrflick.top' 
                    : 'https://z.awstream.net';
                cleanUrl = `${base}/embed/${hashMatch[1]}`;
            }
        }
        
        // Remove duplicates
        const urlKey = cleanUrl.split('?')[0].split('#')[0];
        if (!seenUrls.has(urlKey)) {
            seenUrls.add(urlKey);
            cleanedEmbeds.push({
                url: cleanUrl,
                source: embed.source,
                label: embed.label || null
            });
        }
    }
    
    console.log(`[ToonStream] Extracted ${cleanedEmbeds.length} unique embeds`);
    return cleanedEmbeds;
}

// 4. Get episode URL (FIXED - correct action name)
function getEpisodeUrl(html, season, episode, pageUrl) {
    console.log(`[ToonStream] Getting episode S${season}E${episode}`);
    
    return new Promise(resolve => {
        // Find season selection data
        const seasonDivMatch = html.match(/<div[^>]*aa-drp[^>]*choose-season[^>]*>([\s\S]*?)<\/div>/i);
        if (!seasonDivMatch) {
            console.log('[ToonStream] No season selector found');
            resolve(null);
            return;
        }
        
        const seasonDiv = seasonDivMatch[0];
        
        // Find the requested season
        const seasonNum = parseInt(season);
        let targetSeasonLink = null;
        
        const seasonLinkRegex = /<a[^>]*data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
        let seasonMatch;
        
        while ((seasonMatch = seasonLinkRegex.exec(seasonDiv)) !== null) {
            const seasonText = seasonMatch[3];
            if (seasonText.includes(`Season ${seasonNum}`) || seasonText.includes(`S${seasonNum}`)) {
                targetSeasonLink = {
                    dataPost: seasonMatch[1],
                    dataSeason: seasonMatch[2]
                };
                break;
            }
        }
        
        if (!targetSeasonLink) {
            console.log(`[ToonStream] Season ${season} not found`);
            resolve(null);
            return;
        }
        
        // Load season episodes via AJAX (FIXED ACTION NAME)
        const formData = new URLSearchParams();
        formData.append('action', 'action_select_season_server');  // FIXED
        formData.append('season', targetSeasonLink.dataSeason);
        formData.append('post', targetSeasonLink.dataPost);
        
        console.log('[ToonStream] Loading episodes via AJAX:', {
            action: 'action_select_season_server',
            season: targetSeasonLink.dataSeason,
            post: targetSeasonLink.dataPost
        });
        
        fetch(AJAX_URL, {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': pageUrl
            },
            body: formData.toString()
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`AJAX HTTP ${response.status}`);
            }
            return response.text();
        })
        .then(seasonHtml => {
            // Look for episode
            const episodeNum = parseInt(episode);
            const episodeRegex = /<a[^>]*href="([^"]+)"[^>]*>.*?Episode\s+(\d+)\b[^<]*<\/a>/gi;
            let episodeMatch;
            
            while ((episodeMatch = episodeRegex.exec(seasonHtml)) !== null) {
                if (parseInt(episodeMatch[2]) === episodeNum) {
                    let episodeUrl = episodeMatch[1];
                    
                    // Fix URL
                    if (episodeUrl.startsWith('//')) {
                        episodeUrl = 'https:' + episodeUrl;
                    } else if (episodeUrl.startsWith('/')) {
                        episodeUrl = MAIN_URL + episodeUrl;
                    }
                    
                    console.log(`[ToonStream] Found episode URL: ${episodeUrl}`);
                    resolve(episodeUrl);
                    return;
                }
            }
            
            console.log(`[ToonStream] Episode ${episode} not found in season`);
            resolve(null);
        })
        .catch(error => {
            console.error('[ToonStream] Episode AJAX error:', error);
            resolve(null);
        });
    });
}

// 5. Get quality from URL
function getQuality(url) {
    if (!url) return 'Unknown';
    
    const urlLower = url.toLowerCase();
    
    // Check for quality in URL
    const qualityMatch = urlLower.match(/(\d{3,4})[pk]/);
    if (qualityMatch) {
        const q = parseInt(qualityMatch[1]);
        if (q >= 2160) return '4K';
        if (q >= 1440) return '1440p';
        if (q >= 1080) return '1080p';
        if (q >= 720) return '720p';
        if (q >= 480) return '480p';
        if (q >= 360) return '360p';
        return `${q}p`;
    }
    
    // Check keywords
    if (urlLower.includes('4k') || urlLower.includes('2160') || urlLower.includes('uhd')) return '4K';
    if (urlLower.includes('1080') || urlLower.includes('fullhd')) return '1080p';
    if (urlLower.includes('720') || urlLower.includes('hdready')) return '720p';
    if (urlLower.includes('480')) return '480p';
    
    return 'Unknown';
}

// 6. Get server name from URL
function getServerName(url) {
    if (!url) return 'ToonStream';
    
    if (url.includes('awstream.net')) return 'AWSStream';
    if (url.includes('zephyrflick.top')) return 'Zephyrflick';
    if (url.includes('streamsb.net') || url.includes('sbplay')) return 'StreamSB';
    if (url.includes('vidhide')) return 'Vidhide';
    if (url.includes('filemoon')) return 'FileMoon';
    if (url.includes('cloudy')) return 'Cloudy';
    if (url.includes('dood')) return 'DoodStream';
    
    return 'ToonStream';
}

// 7. Main function
async function getStreams(tmdbId, mediaType, season, episode) {
    console.log(`[ToonStream] getStreams: ${tmdbId}, ${mediaType}, S${season}, E${episode}`);
    
    try {
        // Step 1: Get TMDB info
        const tmdbInfo = await getTMDBInfo(tmdbId, mediaType);
        if (!tmdbInfo || !tmdbInfo.title) {
            console.error('[ToonStream] No TMDB info');
            return [];
        }
        
        console.log('[ToonStream] TMDB:', tmdbInfo);
        
        // Step 2: Search ToonStream
        const searchQuery = tmdbInfo.year ? `${tmdbInfo.title} ${tmdbInfo.year}` : tmdbInfo.title;
        const searchResults = await searchToonStream(searchQuery);
        
        if (searchResults.length === 0) {
            console.error('[ToonStream] No search results');
            return [];
        }
        
        // Get best match
        const bestMatch = searchResults[0];
        console.log('[ToonStream] Selected:', bestMatch);
        
        // Step 3: Fetch content page
        const contentHtml = await fetchText(bestMatch.url);
        if (!contentHtml) {
            console.error('[ToonStream] No content HTML');
            return [];
        }
        
        let targetHtml = contentHtml;
        let targetUrl = bestMatch.url;
        
        // Step 4: Handle episodes for TV series
        if (mediaType === 'tv' && season && episode) {
            const episodeUrl = await getEpisodeUrl(contentHtml, season, episode, bestMatch.url);
            if (episodeUrl) {
                const episodeHtml = await fetchText(episodeUrl, bestMatch.url);
                if (episodeHtml) {
                    targetHtml = episodeHtml;
                    targetUrl = episodeUrl;
                }
            }
        }
        
        // Step 5: Extract embeds
        const embeds = extractEmbedUrls(targetHtml);
        
        if (embeds.length === 0) {
            console.error('[ToonStream] No embeds found');
            return [];
        }
        
        // Step 6: Format streams for Nuvio
        const streams = [];
        
        for (const embed of embeds) {
            // Build title
            let title = tmdbInfo.title;
            if (mediaType === 'tv') {
                if (season && episode) {
                    const s = String(season).padStart(2, '0');
                    const e = String(episode).padStart(2, '0');
                    title += ` S${s}E${e}`;
                } else if (season) {
                    title += ` Season ${season}`;
                }
            }
            
            if (tmdbInfo.year) {
                title += ` (${tmdbInfo.year})`;
            }
            
            // Get quality and server
            const quality = getQuality(embed.url);
            const server = getServerName(embed.url);
            
            // CRITICAL: Include type: "iframe" for Nuvio
            streams.push({
                name: server,
                title: title,
                url: embed.url,
                type: "iframe",  // REQUIRED BY NUVIO
                quality: quality,
                size: 'Unknown',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': targetUrl
                },
                subtitles: [],
                provider: 'toonstream'
            });
        }
        
        // Step 7: Remove duplicates and sort
        const uniqueStreams = [];
        const seen = new Set();
        
        for (const stream of streams) {
            const key = stream.url.split('?')[0];
            if (!seen.has(key)) {
                seen.add(key);
                uniqueStreams.push(stream);
            }
        }
        
        // Sort by quality
        const qualityOrder = {
            '4k': 10, '2160p': 10,
            '1440p': 9,
            '1080p': 8,
            '720p': 7,
            '480p': 6,
            '360p': 5,
            'unknown': 0
        };
        
        uniqueStreams.sort((a, b) => {
            const aQ = a.quality.toLowerCase();
            const bQ = b.quality.toLowerCase();
            return (qualityOrder[bQ] || 0) - (qualityOrder[aQ] || 0);
        });
        
        console.log(`[ToonStream] Returning ${uniqueStreams.length} streams`);
        return uniqueStreams;
        
    } catch (error) {
        console.error('[ToonStream] Error:', error);
        return [];
    }
}

// Export for Nuvio
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.ToonStreamProvider = { getStreams };
}
