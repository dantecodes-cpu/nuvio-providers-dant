// ToonStream provider for Nuvio
// Extracts direct video streams from embed pages

const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const MAIN_URL = 'https://toonstream.one';
const AJAX_URL = 'https://toonstream.one/wp-admin/admin-ajax.php';

// Debug helpers
function createRequestId() {
    try {
        var rand = Math.random().toString(36).slice(2, 8);
        var ts = Date.now().toString(36).slice(-6);
        return rand + ts;
    } catch (e) { return String(Date.now()); }
}

function logRid(rid, msg, extra) {
    try {
        if (typeof extra !== 'undefined') console.log('[ToonStream][rid:' + rid + '] ' + msg, extra);
        else console.log('[ToonStream][rid:' + rid + '] ' + msg);
    } catch (e) { }
}

// Headers for requests
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1'
};

// Generic fetch helper
function fetchRequest(url, options) {
    var merged = Object.assign({ method: 'GET', headers: HEADERS }, options || {});
    return fetch(url, merged).then(function (response) {
        if (!response.ok) {
            throw new Error('HTTP ' + response.status + ': ' + response.statusText);
        }
        return response.text();
    }).catch(function (error) {
        console.error('[ToonStream] Fetch error for', url, error);
        throw error;
    });
}

// Parse HTML - simple DOM-like parser
function parseHTML(html) {
    return {
        // Get element by selector
        querySelector: function(selector) {
            if (selector === 'header.entry-header > h1') {
                var match = html.match(/<header[^>]*entry-header[^>]*>[\s\S]*?<h1[^>]*>([^<]+)<\/h1>/i);
                return match ? { textContent: match[1].trim() } : null;
            }
            if (selector === '#aa-options > div > iframe') {
                var iframeRegex = /<iframe[^>]*data-src="([^"]+)"[^>]*>/gi;
                var match;
                var iframes = [];
                while ((match = iframeRegex.exec(html)) !== null) {
                    iframes.push({
                        getAttribute: function(attr) {
                            if (attr === 'data-src') return match[1];
                            return '';
                        }
                    });
                }
                return iframes.length > 0 ? iframes[0] : null;
            }
            if (selector === 'iframe') {
                var iframeRegex = /<iframe[^>]*src="([^"]+)"[^>]*>/gi;
                var match = iframeRegex.exec(html);
                return match ? {
                    getAttribute: function(attr) {
                        if (attr === 'src') return match[1];
                        return '';
                    }
                } : null;
            }
            if (selector === 'div.aa-drp.choose-season > ul > li > a') {
                var seasonRegex = /<div[^>]*aa-drp[^>]*choose-season[^>]*>([\s\S]*?)<\/div>/i;
                var seasonMatch = html.match(seasonRegex);
                if (seasonMatch) {
                    var linkRegex = /<a[^>]*data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
                    var linkMatch = linkRegex.exec(seasonMatch[0]);
                    if (linkMatch) {
                        return {
                            getAttribute: function(attr) {
                                if (attr === 'data-post') return linkMatch[1];
                                if (attr === 'data-season') return linkMatch[2];
                                return '';
                            },
                            textContent: linkMatch[3] || ''
                        };
                    }
                }
                return null;
            }
            if (selector === '#movies-a > ul > li article') {
                var articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
                var articleMatch = articleRegex.exec(html);
                if (articleMatch) {
                    var articleHtml = articleMatch[0];
                    return {
                        querySelector: function(subSelector) {
                            if (subSelector === 'header > h2') {
                                var titleMatch = articleHtml.match(/<h2[^>]*>([^<]+)<\/h2>/i);
                                return titleMatch ? { textContent: titleMatch[1].trim() } : null;
                            }
                            if (subSelector === 'a') {
                                var linkMatch = articleHtml.match(/<a[^>]*href="([^"]+)"/i);
                                return linkMatch ? { getAttribute: function(a) { return linkMatch[1]; } } : null;
                            }
                            if (subSelector === 'img') {
                                var imgMatch = articleHtml.match(/<img[^>]*src="([^"]+)"/i);
                                return imgMatch ? { getAttribute: function(a) { return imgMatch[1]; } } : null;
                            }
                            return null;
                        }
                    };
                }
                return null;
            }
            return null;
        },
        // Get all elements by selector
        querySelectorAll: function(selector) {
            var elem = this.querySelector(selector);
            if (Array.isArray(elem)) return elem;
            if (elem && selector === '#aa-options > div > iframe') {
                // Return all iframes
                var iframeRegex = /<iframe[^>]*data-src="([^"]+)"[^>]*>/gi;
                var matches = [];
                var match;
                while ((match = iframeRegex.exec(html)) !== null) {
                    matches.push({
                        getAttribute: function(attr) {
                            if (attr === 'data-src') return match[1];
                            return '';
                        }
                    });
                }
                return matches;
            }
            if (elem && selector === '#movies-a > ul > li article') {
                // Return all articles
                var articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
                var articles = [];
                var articleMatch;
                while ((articleMatch = articleRegex.exec(html)) !== null) {
                    var articleHtml = articleMatch[0];
                    articles.push({
                        querySelector: function(subSelector) {
                            if (subSelector === 'header > h2') {
                                var titleMatch = articleHtml.match(/<h2[^>]*>([^<]+)<\/h2>/i);
                                return titleMatch ? { textContent: titleMatch[1].trim() } : null;
                            }
                            if (subSelector === 'a') {
                                var linkMatch = articleHtml.match(/<a[^>]*href="([^"]+)"/i);
                                return linkMatch ? { getAttribute: function(a) { return linkMatch[1]; } } : null;
                            }
                            if (subSelector === 'img') {
                                var imgMatch = articleHtml.match(/<img[^>]*src="([^"]+)"/i);
                                return imgMatch ? { getAttribute: function(a) { return imgMatch[1]; } } : null;
                            }
                            return null;
                        }
                    });
                }
                return articles;
            }
            return elem ? [elem] : [];
        }
    };
}

// Get TMDB details
function getTMDBDetails(tmdbId, mediaType) {
    var url = TMDB_BASE_URL + '/' + mediaType + '/' + tmdbId + '?api_key=' + TMDB_API_KEY;
    return fetchRequest(url).then(function (html) {
        try {
            var data = JSON.parse(html);
            return {
                title: data.title || data.name || data.original_title || data.original_name,
                originalTitle: data.original_title || data.original_name,
                year: mediaType === 'movie' 
                    ? (data.release_date ? parseInt(data.release_date.split('-')[0]) : null)
                    : (data.first_air_date ? parseInt(data.first_air_date.split('-')[0]) : null)
            };
        } catch (e) {
            return { title: null, originalTitle: null, year: null };
        }
    }).catch(function () {
        return { title: null, originalTitle: null, year: null };
    });
}

// Search ToonStream by title
function searchToonStream(query) {
    var searchUrl = MAIN_URL + '/?s=' + encodeURIComponent(query);
    return fetchRequest(searchUrl).then(function (html) {
        var doc = parseHTML(html);
        var results = [];
        var items = doc.querySelectorAll('#movies-a > ul > li article');
        
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var titleElem = item.querySelector('header > h2');
            var linkElem = item.querySelector('a');
            
            if (titleElem && linkElem) {
                var title = titleElem.textContent.replace('Watch Online', '').trim();
                var url = linkElem.getAttribute('href');
                
                // Fix URL if needed
                if (url && !url.startsWith('http')) {
                    url = url.startsWith('//') ? 'https:' + url : MAIN_URL + url;
                }
                
                results.push({
                    title: title,
                    url: url,
                    type: url.includes('/series/') ? 'tv' : 'movie'
                });
            }
        }
        return results;
    }).catch(function () {
        return [];
    });
}

// Extract video URLs from embed pages using regex patterns
function extractVideoUrls(html) {
    var videoUrls = [];
    
    // Pattern 1: Direct m3u8 URLs (like your examples)
    var m3u8Pattern = /(https?:\/\/[^\s"'<>]+\.m3u8)/gi;
    var matches = html.match(m3u8Pattern);
    if (matches) {
        for (var i = 0; i < matches.length; i++) {
            var url = matches[i].replace(/\\\//g, '/'); // Fix escaped slashes
            if (url.includes('master.m3u8') || url.includes('playlist.m3u8')) {
                videoUrls.push({
                    url: url,
                    type: 'hls',
                    quality: extractQualityFromUrl(url)
                });
            }
        }
    }
    
    // Pattern 2: JSON payloads containing video URLs
    var jsonPattern = /"sources"\s*:\s*\[([^\]]+)\]/g;
    var jsonMatch;
    while ((jsonMatch = jsonPattern.exec(html)) !== null) {
        try {
            var sourcesStr = '[' + jsonMatch[1] + ']';
            var sources = JSON.parse(sourcesStr);
            if (Array.isArray(sources)) {
                for (var j = 0; j < sources.length; j++) {
                    var source = sources[j];
                    if (source.file) {
                        videoUrls.push({
                            url: source.file,
                            type: source.type || 'hls',
                            quality: source.label || extractQualityFromUrl(source.file)
                        });
                    }
                }
            }
        } catch (e) {
            // Skip invalid JSON
        }
    }
    
    // Pattern 3: VideoJS player config
    var videojsPattern = /videojs\s*\(\s*['"][^'"]+['"]\s*,\s*(\{[\s\S]*?\})\s*\)/g;
    var videojsMatch;
    while ((videojsMatch = videojsPattern.exec(html)) !== null) {
        try {
            var config = JSON.parse(videojsMatch[1]);
            if (config.sources && Array.isArray(config.sources)) {
                for (var k = 0; k < config.sources.length; k++) {
                    var src = config.sources[k];
                    if (src.src) {
                        videoUrls.push({
                            url: src.src,
                            type: src.type || 'hls',
                            quality: src.label || extractQualityFromUrl(src.src)
                        });
                    }
                }
            }
        } catch (e) {
            // Skip invalid JSON
        }
    }
    
    // Pattern 4: Direct mp4/mkv URLs
    var directPattern = /(https?:\/\/[^\s"'<>]+\.(mp4|mkv|webm|avi|mov))/gi;
    var directMatches = html.match(directPattern);
    if (directMatches) {
        for (var l = 0; l < directMatches.length; l++) {
            videoUrls.push({
                url: directMatches[l],
                type: 'direct',
                quality: extractQualityFromUrl(directMatches[l])
            });
        }
    }
    
    return videoUrls;
}

// Extract quality from URL
function extractQualityFromUrl(url) {
    var patterns = [
        /(\d{3,4})p/i,
        /(\d{3,4})k/i,
        /quality[_-]?(\d{3,4})/i,
        /res[_-]?(\d{3,4})/i,
        /(\d{3,4})x\d{3,4}/i
    ];
    for (var i = 0; i < patterns.length; i++) {
        var m = url.match(patterns[i]);
        if (m) {
            var q = parseInt(m[1]);
            if (q >= 240 && q <= 4320) return q + 'p';
        }
    }
    // Check common CDN patterns
    if (url.includes('1080')) return '1080p';
    if (url.includes('720')) return '720p';
    if (url.includes('480')) return '480p';
    if (url.includes('360')) return '360p';
    if (url.includes('hd')) return 'HD';
    if (url.includes('4k')) return '4K';
    
    return 'Unknown';
}

// Process iframe embed to extract video URLs
function processEmbedPage(embedUrl) {
    return fetchRequest(embedUrl).then(function (html) {
        // First, try to extract direct video URLs
        var videoUrls = extractVideoUrls(html);
        
        // If no direct URLs found, look for nested iframes
        if (videoUrls.length === 0) {
            var doc = parseHTML(html);
            var iframe = doc.querySelector('iframe');
            if (iframe) {
                var nestedUrl = iframe.getAttribute('src');
                if (nestedUrl) {
                    // Fix URL if relative
                    if (nestedUrl.startsWith('//')) {
                        nestedUrl = 'https:' + nestedUrl;
                    } else if (nestedUrl.startsWith('/')) {
                        var baseDomain = embedUrl.match(/https?:\/\/[^\/]+/)[0];
                        nestedUrl = baseDomain + nestedUrl;
                    }
                    
                    // Process nested iframe
                    return processEmbedPage(nestedUrl);
                }
            }
        }
        
        return videoUrls;
    }).catch(function (error) {
        console.error('[ToonStream] Error processing embed:', embedUrl, error);
        return [];
    });
}

// Extract streams from ToonStream page
function extractStreamsFromPage(pageUrl, season, episode) {
    return fetchRequest(pageUrl).then(function (html) {
        var streams = [];
        var doc = parseHTML(html);
        
        // Check if it's a series page
        if (pageUrl.includes('/series/') || doc.querySelector('div.aa-drp.choose-season')) {
            return extractSeriesStreams(doc, pageUrl, season, episode);
        } else {
            return extractMovieStreams(doc, pageUrl);
        }
    }).catch(function (error) {
        console.error('[ToonStream] Error loading page:', pageUrl, error);
        return [];
    });
}

// Extract movie streams
function extractMovieStreams(doc, pageUrl) {
    return new Promise(function (resolve) {
        var streams = [];
        var iframes = doc.querySelectorAll('#aa-options > div > iframe');
        
        if (!iframes || iframes.length === 0) {
            resolve(streams);
            return;
        }
        
        var processed = 0;
        var total = iframes.length;
        
        for (var i = 0; i < iframes.length; i++) {
            (function (iframe) {
                var serverLink = iframe.getAttribute('data-src');
                if (serverLink) {
                    processEmbedPage(serverLink)
                        .then(function (videoUrls) {
                            for (var j = 0; j < videoUrls.length; j++) {
                                streams.push({
                                    url: videoUrls[j].url,
                                    quality: videoUrls[j].quality || 'Unknown',
                                    serverType: 'ToonStream',
                                    headers: {
                                        'Referer': serverLink,
                                        'User-Agent': HEADERS['User-Agent']
                                    }
                                });
                            }
                            processed++;
                            if (processed === total) resolve(streams);
                        })
                        .catch(function () {
                            processed++;
                            if (processed === total) resolve(streams);
                        });
                } else {
                    processed++;
                    if (processed === total) resolve(streams);
                }
            })(iframes[i]);
        }
    });
}

// Extract series streams
function extractSeriesStreams(doc, pageUrl, season, episode) {
    return new Promise(function (resolve) {
        var streams = [];
        var seasonLink = doc.querySelector('div.aa-drp.choose-season > ul > li > a');
        
        if (!seasonLink) {
            resolve(streams);
            return;
        }
        
        var dataPost = seasonLink.getAttribute('data-post');
        var dataSeason = seasonLink.getAttribute('data-season');
        var seasonText = seasonLink.textContent;
        
        // If specific season requested, check match
        if (season && !seasonText.includes('Season ' + season)) {
            resolve(streams);
            return;
        }
        
        // Load season data via AJAX
        var formData = 'action=action_select_season&season=' + encodeURIComponent(dataSeason) + '&post=' + encodeURIComponent(dataPost);
        
        fetch(AJAX_URL, {
            method: 'POST',
            headers: Object.assign({}, HEADERS, {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest'
            }),
            body: formData
        })
        .then(function (response) { return response.text(); })
        .then(function (seasonHtml) {
            // Extract episode links from season HTML
            var episodeRegex = /<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?Episode\s+(\d+)[\s\S]*?<\/a>/gi;
            var episodeMatch;
            
            while ((episodeMatch = episodeRegex.exec(seasonHtml)) !== null) {
                var episodeUrl = episodeMatch[1];
                var episodeNum = parseInt(episodeMatch[2]);
                
                // If specific episode requested, check match
                if (episode && episodeNum !== episode) {
                    continue;
                }
                
                // Fix URL if needed
                if (episodeUrl && !episodeUrl.startsWith('http')) {
                    episodeUrl = episodeUrl.startsWith('//') ? 'https:' + episodeUrl : MAIN_URL + episodeUrl;
                }
                
                // Extract streams from episode page
                extractStreamsFromPage(episodeUrl)
                    .then(function (episodeStreams) {
                        streams = streams.concat(episodeStreams);
                    });
            }
            
            // Wait for all episode streams to be processed
            setTimeout(function () {
                resolve(streams);
            }, 2000);
        })
        .catch(function (error) {
            console.error('[ToonStream] Error loading season:', error);
            resolve(streams);
        });
    });
}

// Format streams for Nuvio
function formatToNuvioStreams(streams, mediaTitle) {
    var links = [];
    
    for (var i = 0; i < streams.length; i++) {
        var s = streams[i];
        
        links.push({
            name: 'ToonStream - ' + (s.quality || 'Unknown'),
            title: mediaTitle || '',
            url: s.url,
            quality: s.quality || 'Unknown',
            size: 'Unknown',
            headers: s.headers || {
                'User-Agent': HEADERS['User-Agent'],
                'Accept': 'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'identity',
                'Referer': MAIN_URL
            },
            subtitles: [],
            provider: 'toonstream'
        });
    }
    
    // Sort by quality
    var order = { '4K': 7, '2160p': 7, '1440p': 6, '1080p': 5, '720p': 4, '480p': 3, '360p': 2, '240p': 1, 'Unknown': 0 };
    links.sort(function (a, b) { return (order[b.quality] || 0) - (order[a.quality] || 0); });
    
    return links;
}

// Main Nuvio function
function getStreams(tmdbId, mediaType, season, episode) {
    var rid = createRequestId();
    logRid(rid, 'getStreams start', { tmdbId: tmdbId, mediaType: mediaType, season: season, episode: episode });
    
    var mediaInfo = null;
    
    // Step 1: Get title from TMDB
    return getTMDBDetails(tmdbId, mediaType)
        .then(function (tmdbData) {
            if (!tmdbData || !tmdbData.title) {
                throw new Error('Could not get TMDB details');
            }
            mediaInfo = tmdbData;
            logRid(rid, 'TMDB details', { title: tmdbData.title, year: tmdbData.year });
            
            // Step 2: Search ToonStream with the title
            var searchQuery = tmdbData.title;
            if (tmdbData.year) {
                searchQuery += ' ' + tmdbData.year;
            }
            return searchToonStream(searchQuery);
        })
        .then(function (searchResults) {
            if (!searchResults || searchResults.length === 0) {
                throw new Error('No results found on ToonStream');
            }
            
            logRid(rid, 'Search results', { count: searchResults.length });
            
            // Find the best match (prefer correct media type)
            var bestMatch = searchResults[0];
            for (var i = 0; i < searchResults.length; i++) {
                if ((mediaType === 'tv' && searchResults[i].type === 'tv') ||
                    (mediaType === 'movie' && searchResults[i].type === 'movie')) {
                    bestMatch = searchResults[i];
                    break;
                }
            }
            
            logRid(rid, 'Selected match', { title: bestMatch.title, url: bestMatch.url, type: bestMatch.type });
            
            // Step 3: Extract streams from the selected page
            return extractStreamsFromPage(bestMatch.url, season, episode);
        })
        .then(function (streams) {
            // Build media title
            var mediaTitle = mediaInfo.title;
            if (mediaType === 'tv' && season && episode) {
                var s = String(season).padStart(2, '0');
                var e = String(episode).padStart(2, '0');
                mediaTitle = mediaInfo.title + ' S' + s + 'E' + e;
            } else if (mediaInfo.year) {
                mediaTitle = mediaInfo.title + ' (' + mediaInfo.year + ')';
            }
            
            var formatted = formatToNuvioStreams(streams, mediaTitle);
            logRid(rid, 'Returning streams', { count: formatted.length });
            return formatted;
        })
        .catch(function (err) {
            logRid(rid, 'ERROR: ' + (err && err.message ? err.message : String(err)));
            return [];
        });
}

// Export for Nuvio
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.ToonStreamModule = { getStreams };
}
