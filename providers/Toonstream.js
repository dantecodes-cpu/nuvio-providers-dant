// ToonStream Provider for Nuvio
// Cartoon-focused provider using ToonStream.one

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.one";

console.log('[ToonStream] Provider initialized');

// ================= TMDB HELPER =================
function getTMDBDetails(tmdbId, mediaType) {
    const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    return fetch(url)
        .then(response => response.ok ? response.json() : null)
        .then(data => {
            if (!data) return null;
            
            return {
                title: mediaType === 'movie' ? data.title : data.name,
                originalTitle: mediaType === 'movie' ? data.original_title : data.original_name,
                year: mediaType === 'movie' 
                    ? (data.release_date ? data.release_date.split('-')[0] : null)
                    : (data.first_air_date ? data.first_air_date.split('-')[0] : null),
                overview: data.overview || ''
            };
        })
        .catch(error => {
            console.error('[ToonStream] TMDB error:', error);
            return null;
        });
}

// ================= SEARCH TOONSTREAM =================
function searchToonStream(query) {
    const searchUrl = `${MAIN_URL}/?s=${encodeURIComponent(query)}`;
    console.log('[ToonStream] Searching:', searchUrl);
    
    return fetch(searchUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5'
        }
    })
    .then(response => response.ok ? response.text() : null)
    .then(html => {
        if (!html) return [];
        
        const results = [];
        
        // Parse search results using regex (no DOM parser needed)
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
            
            const title = titleMatch[1].replace('Watch Online', '').trim();
            let url = urlMatch[1];
            
            // Fix URL if needed
            if (url.startsWith('//')) {
                url = 'https:' + url;
            } else if (url.startsWith('/')) {
                url = MAIN_URL + url;
            }
            
            // Determine type
            const type = url.includes('/series/') ? 'tv' : 'movie';
            
            results.push({
                title: title,
                url: url,
                type: type
            });
        }
        
        console.log('[ToonStream] Search results:', results.length);
        return results;
    })
    .catch(error => {
        console.error('[ToonStream] Search error:', error);
        return [];
    });
}

// ================= EXTRACT EMBEDS =================
function extractEmbedUrls(html) {
    const embeds = [];
    
    // Look for iframes with data-src (ToonStream pattern)
    const iframeRegex = /<iframe[^>]*data-src="([^"]+)"[^>]*>/gi;
    let iframeMatch;
    
    while ((iframeMatch = iframeRegex.exec(html)) !== null) {
        let embedUrl = iframeMatch[1];
        
        // Fix URL if needed
        if (embedUrl.startsWith('//')) {
            embedUrl = 'https:' + embedUrl;
        }
        
        console.log('[ToonStream] Found embed:', embedUrl);
        embeds.push(embedUrl);
    }
    
    // Also look for regular iframe src
    const srcRegex = /<iframe[^>]*src="([^"]+)"[^>]*>/gi;
    let srcMatch;
    
    while ((srcMatch = srcRegex.exec(html)) !== null) {
        let embedUrl = srcMatch[1];
        
        if (embedUrl.startsWith('//')) {
            embedUrl = 'https:' + embedUrl;
        }
        
        console.log('[ToonStream] Found iframe src:', embedUrl);
        embeds.push(embedUrl);
    }
    
    return embeds;
}

// ================= PROCESS AWSSTREAM/ZEPHYR =================
function processAWSStream(embedUrl) {
    console.log('[ToonStream] Processing AWSStream embed:', embedUrl);
    
    return new Promise(resolve => {
        try {
            // Extract hash from URL
            const extractedHash = embedUrl.substring(embedUrl.lastIndexOf('/') + 1);
            const isZephyrflick = embedUrl.includes('zephyrflick.top');
            const baseUrl = isZephyrflick ? 'https://play.zephyrflick.top' : 'https://z.awstream.net';
            
            // Build AJAX request URL (from Cloudstream AWSStream extractor)
            const apiUrl = `${baseUrl}/player/index.php?data=${extractedHash}&do=getVideo`;
            
            console.log('[ToonStream] AWSStream API URL:', apiUrl);
            
            // Prepare form data
            const formData = new URLSearchParams();
            formData.append('hash', extractedHash);
            formData.append('r', baseUrl);
            
            fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'x-requested-with': 'XMLHttpRequest',
                    'Referer': embedUrl
                },
                body: formData.toString()
            })
            .then(response => response.ok ? response.json() : null)
            .then(data => {
                if (data && data.videoSource) {
                    console.log('[ToonStream] Got video source:', data.videoSource.substring(0, 100) + '...');
                    
                    resolve([{
                        url: data.videoSource,
                        quality: '1080p',
                        serverType: isZephyrflick ? 'Zephyrflick' : 'AWSStream',
                        headers: {
                            'Referer': baseUrl,
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Accept': 'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5'
                        }
                    }]);
                } else {
                    console.log('[ToonStream] No videoSource in AWSStream response');
                    resolve([]);
                }
            })
            .catch(error => {
                console.error('[ToonStream] AWSStream fetch error:', error);
                resolve([]);
            });
        } catch (error) {
            console.error('[ToonStream] AWSStream processing error:', error);
            resolve([]);
        }
    });
}

// ================= PROCESS EMBED PAGE =================
function processEmbedPage(embedUrl) {
    console.log('[ToonStream] Processing embed page:', embedUrl);
    
    return new Promise(resolve => {
        // Check if it's AWSStream/Zephyrflick
        if (embedUrl.includes('awstream.net') || embedUrl.includes('zephyrflick.top')) {
            return processAWSStream(embedUrl).then(resolve);
        }
        
        // For other embeds, fetch and look for direct video URLs
        fetch(embedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': MAIN_URL
            }
        })
        .then(response => response.ok ? response.text() : null)
        .then(html => {
            if (!html) {
                resolve([]);
                return;
            }
            
            const streams = [];
            
            // Look for direct m3u8 URLs
            const m3u8Regex = /(https?:\/\/[^\s"'<>]+\.m3u8)/gi;
            const m3u8Matches = html.match(m3u8Regex);
            
            if (m3u8Matches) {
                m3u8Matches.forEach(url => {
                    console.log('[ToonStream] Found direct m3u8:', url.substring(0, 100) + '...');
                    streams.push({
                        url: url,
                        quality: 'Unknown',
                        serverType: 'Direct',
                        headers: {
                            'Referer': embedUrl,
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });
                });
            }
            
            // Look for nested iframes
            const iframeRegex = /<iframe[^>]*src="([^"]+)"[^>]*>/i;
            const iframeMatch = html.match(iframeRegex);
            
            if (iframeMatch) {
                const nestedUrl = iframeMatch[1];
                console.log('[ToonStream] Found nested iframe, processing recursively:', nestedUrl);
                
                // Process nested iframe
                processEmbedPage(nestedUrl).then(nestedStreams => {
                    streams.push(...nestedStreams);
                    resolve(streams);
                });
                return;
            }
            
            resolve(streams);
        })
        .catch(error => {
            console.error('[ToonStream] Embed page fetch error:', error);
            resolve([]);
        });
    });
}

// ================= HANDLE TV SERIES =================
function getEpisodeUrl(html, season, episode) {
    console.log('[ToonStream] Looking for episode S' + season + 'E' + episode);
    
    // Look for season selection dropdown
    const seasonDivMatch = html.match(/<div[^>]*aa-drp[^>]*choose-season[^>]*>[\s\S]*?<\/div>/i);
    if (!seasonDivMatch) return null;
    
    const seasonDiv = seasonDivMatch[0];
    
    // Find the correct season link
    const seasonRegex = new RegExp(`<a[^>]*data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>.*?Season\\s+${season}[\\s\\S]*?<\\/a>`, 'i');
    const seasonMatch = seasonDiv.match(seasonRegex);
    
    if (!seasonMatch) {
        console.log('[ToonStream] Season not found');
        return null;
    }
    
    const dataPost = seasonMatch[1];
    const dataSeason = seasonMatch[2];
    
    console.log('[ToonStream] Found season data:', { dataPost, dataSeason });
    
    // Load season episodes via AJAX
    return new Promise(resolve => {
        const formData = new URLSearchParams();
        formData.append('action', 'action_select_season');
        formData.append('season', dataSeason);
        formData.append('post', dataPost);
        
        fetch(`${MAIN_URL}/wp-admin/admin-ajax.php`, {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: formData.toString()
        })
        .then(response => response.ok ? response.text() : null)
        .then(seasonHtml => {
            if (!seasonHtml) {
                resolve(null);
                return;
            }
            
            // Look for episode link
            const episodeRegex = new RegExp(`<a[^>]*href="([^"]+)"[^>]*>.*?Episode\\s+${episode}[\\s\\S]*?<\\/a>`, 'i');
            const episodeMatch = seasonHtml.match(episodeRegex);
            
            if (episodeMatch) {
                let episodeUrl = episodeMatch[1];
                
                // Fix URL if needed
                if (episodeUrl.startsWith('//')) {
                    episodeUrl = 'https:' + episodeUrl;
                } else if (episodeUrl.startsWith('/')) {
                    episodeUrl = MAIN_URL + episodeUrl;
                }
                
                console.log('[ToonStream] Found episode URL:', episodeUrl);
                resolve(episodeUrl);
            } else {
                console.log('[ToonStream] Episode not found in season HTML');
                resolve(null);
            }
        })
        .catch(error => {
            console.error('[ToonStream] Season AJAX error:', error);
            resolve(null);
        });
    });
}

// ================= MAIN FUNCTION =================
function getStreams(tmdbId, mediaType, season, episode) {
    console.log(`[ToonStream] Request: TMDB=${tmdbId}, Type=${mediaType}, Season=${season}, Episode=${episode}`);
    
    let mediaInfo = null;
    
    return getTMDBDetails(tmdbId, mediaType)
        .then(tmdbData => {
            if (!tmdbData || !tmdbData.title) {
                console.error('[ToonStream] Failed to get TMDB data');
                return Promise.reject('No TMDB data');
            }
            
            mediaInfo = tmdbData;
            console.log('[ToonStream] TMDB data:', tmdbData);
            
            // Search ToonStream
            const searchQuery = tmdbData.title + (tmdbData.year ? ' ' + tmdbData.year : '');
            return searchToonStream(searchQuery);
        })
        .then(searchResults => {
            if (!searchResults || searchResults.length === 0) {
                console.error('[ToonStream] No search results');
                return Promise.reject('No search results');
            }
            
            // Find best match (prefer correct media type)
            let bestMatch = searchResults[0];
            const searchTitle = mediaInfo.title.toLowerCase();
            
            for (const result of searchResults) {
                const resultTitle = result.title.toLowerCase();
                const desiredType = mediaType === 'tv' ? 'tv' : 'movie';
                
                if (result.type === desiredType) {
                    if (resultTitle.includes(searchTitle) || searchTitle.includes(resultTitle)) {
                        bestMatch = result;
                        break;
                    }
                }
            }
            
            console.log('[ToonStream] Selected:', bestMatch);
            return fetch(bestMatch.url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': MAIN_URL
                }
            }).then(response => response.text());
        })
        .then(html => {
            if (!html) {
                console.error('[ToonStream] Failed to fetch content page');
                return Promise.reject('No content HTML');
            }
            
            console.log('[ToonStream] Content page fetched, length:', html.length);
            
            // Handle TV series episodes
            if (mediaType === 'tv' && season && episode) {
                return getEpisodeUrl(html, season, episode)
                    .then(episodeUrl => {
                        if (!episodeUrl) {
                            console.error('[ToonStream] Episode not found');
                            return Promise.reject('Episode not found');
                        }
                        
                        return fetch(episodeUrl, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                'Referer': MAIN_URL
                            }
                        }).then(response => response.text());
                    });
            }
            
            return html;
        })
        .then(html => {
            // Extract embed URLs
            const embedUrls = extractEmbedUrls(html);
            console.log('[ToonStream] Found embed URLs:', embedUrls.length);
            
            if (embedUrls.length === 0) {
                console.error('[ToonStream] No embeds found');
                return [];
            }
            
            // Process all embeds in parallel
            const embedPromises = embedUrls.map(embedUrl => processEmbedPage(embedUrl));
            return Promise.all(embedPromises);
        })
        .then(embedResults => {
            // Flatten all streams
            const allStreams = embedResults.flat();
            console.log('[ToonStream] Total raw streams found:', allStreams.length);
            
            if (allStreams.length === 0) {
                return [];
            }
            
            // Format for Nuvio
            const formattedStreams = [];
            const seenUrls = new Set();
            
            for (const stream of allStreams) {
                if (!stream.url || seenUrls.has(stream.url)) continue;
                
                seenUrls.add(stream.url);
                
                // Build title
                let title = mediaInfo.title;
                if (mediaType === 'tv') {
                    if (season && episode) {
                        title += ` S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
                    } else if (season) {
                        title += ` Season ${season}`;
                    }
                }
                
                if (mediaInfo.year) {
                    title += ` (${mediaInfo.year})`;
                }
                
                formattedStreams.push({
                    name: 'ToonStream',
                    title: title,
                    url: stream.url,
                    quality: stream.quality || 'Unknown',
                    size: 'Unknown',
                    headers: stream.headers || {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
                        'Accept-Language': 'en-US,en;q=0.9'
                    },
                    subtitles: [],
                    provider: 'toonstream'
                });
            }
            
            // Sort by quality (highest first)
            const qualityOrder = {
                '4K': 9, '2160p': 9,
                '1440p': 8,
                '1080p': 7,
                '720p': 6,
                '480p': 5,
                '360p': 4,
                '240p': 3,
                'Unknown': 0
            };
            
            formattedStreams.sort((a, b) => {
                const aQuality = a.quality.toLowerCase();
                const bQuality = b.quality.toLowerCase();
                return (qualityOrder[bQuality] || 0) - (qualityOrder[aQuality] || 0);
            });
            
            console.log('[ToonStream] Returning formatted streams:', formattedStreams.length);
            return formattedStreams;
        })
        .catch(error => {
            console.error('[ToonStream] Error in getStreams:', error);
            return [];
        });
}

// ================= EXPORT FOR NUVIO =================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    // For React Native/Nuvio environment
    global.ToonStreamProvider = { getStreams };
}
