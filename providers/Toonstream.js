// ToonStream Cartoon Provider for Nuvio
// Direct scraping for Western cartoons - No MAL/AniList dependency

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

// Simple HTML parser for ToonStream's structure
function parseHTML(html) {
    return {
        querySelector: function(selector) {
            if (selector === 'header.entry-header > h1') {
                var match = html.match(/<header[^>]*entry-header[^>]*>[\s\S]*?<h1[^>]*>([^<]+)<\/h1>/i);
                return match ? { textContent: match[1].trim() } : null;
            }
            return null;
        },
        querySelectorAll: function(selector) {
            if (selector === '#movies-a > ul > li article') {
                var articles = [];
                var articleRegex = /<article[\s\S]*?<\/article>/gi;
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
                                return linkMatch ? { getAttribute: function() { return linkMatch[1]; } } : null;
                            }
                            return null;
                        }
                    });
                }
                return articles;
            }
            if (selector === '#aa-options > div > iframe') {
                var iframes = [];
                var iframeRegex = /<iframe[^>]*data-src="([^"]+)"[^>]*>/gi;
                var iframeMatch;
                
                while ((iframeMatch = iframeRegex.exec(html)) !== null) {
                    iframes.push({
                        getAttribute: function(attr) {
                            if (attr === 'data-src') return iframeMatch[1];
                            return '';
                        }
                    });
                }
                return iframes;
            }
            if (selector === 'div.aa-drp.choose-season > ul > li > a') {
                var links = [];
                var linkRegex = /<a[^>]*data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
                var linkMatch;
                
                while ((linkMatch = linkRegex.exec(html)) !== null) {
                    links.push({
                        getAttribute: function(attr) {
                            if (attr === 'data-post') return linkMatch[1];
                            if (attr === 'data-season') return linkMatch[2];
                            return '';
                        },
                        textContent: linkMatch[3] || ''
                    });
                }
                return links;
            }
            if (selector === 'article') {
                var articles = [];
                var articleRegex = /<article[\s\S]*?>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/gi;
                var articleMatch;
                
                while ((articleMatch = articleRegex.exec(html)) !== null) {
                    articles.push({
                        querySelector: function(subSelector) {
                            if (subSelector === 'a') {
                                return { getAttribute: function() { return articleMatch[1]; } };
                            }
                            if (subSelector === 'header.entry-header > h2') {
                                return { textContent: articleMatch[2] || '' };
                            }
                            return null;
                        }
                    });
                }
                return articles;
            }
            return [];
        }
    };
}

// Get TMDB details for cartoon
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
                    : (data.first_air_date ? parseInt(data.first_air_date.split('-')[0]) : null),
                // Cartoon-specific metadata
                genres: data.genres ? data.genres.map(function(g) { return g.name; }) : [],
                overview: data.overview || ''
            };
        } catch (e) {
            return { title: null, originalTitle: null, year: null, genres: [], overview: '' };
        }
    }).catch(function () {
        return { title: null, originalTitle: null, year: null, genres: [], overview: '' };
    });
}

// Search ToonStream directly (no MAL/AniList dependency)
function searchToonStreamDirect(query) {
    var searchUrl = MAIN_URL + '/?s=' + encodeURIComponent(query);
    console.log('[ToonStream] Searching:', searchUrl);
    
    return fetchRequest(searchUrl).then(function (html) {
        console.log('[ToonStream] Search HTML length:', html.length);
        
        var doc = parseHTML(html);
        var results = [];
        var items = doc.querySelectorAll('#movies-a > ul > li article');
        
        console.log('[ToonStream] Found articles:', items.length);
        
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
                
                console.log('[ToonStream] Found result:', { title: title, url: url });
                
                // Determine type from URL or title
                var type = url.includes('/series/') ? 'tv' : 'movie';
                
                results.push({
                    title: title,
                    url: url,
                    type: type
                });
            }
        }
        
        return results;
    }).catch(function (error) {
        console.error('[ToonStream] Search error:', error);
        return [];
    });
}

// Extract AWSStream video (from Cloudstream's AWSStream extractor)
function extractAWSStreamVideo(embedUrl) {
    return new Promise(function (resolve) {
        try {
            console.log('[ToonStream] Extracting AWSStream:', embedUrl);
            
            // Extract hash from URL
            var extractedHash = embedUrl.substring(embedUrl.lastIndexOf('/') + 1);
            var isZephyrflick = embedUrl.includes('zephyrflick.top');
            var mainUrl = isZephyrflick ? 'https://play.zephyrflick.top' : 'https://z.awstream.net';
            
            // Build AJAX request URL (exactly like Cloudstream)
            var m3u8Url = mainUrl + '/player/index.php?data=' + extractedHash + '&do=getVideo';
            
            console.log('[ToonStream] AWSStream API URL:', m3u8Url);
            
            // Prepare form data
            var formData = new URLSearchParams();
            formData.append('hash', extractedHash);
            formData.append('r', mainUrl);
            
            // Make the AJAX request
            fetch(m3u8Url, {
                method: 'POST',
                headers: {
                    'User-Agent': HEADERS['User-Agent'],
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'x-requested-with': 'XMLHttpRequest',
                    'Referer': embedUrl
                },
                body: formData.toString()
            })
            .then(function (response) {
                if (!response.ok) {
                    console.error('[ToonStream] AWSStream API error:', response.status);
                    throw new Error('HTTP ' + response.status);
                }
                return response.json();
            })
            .then(function (data) {
                console.log('[ToonStream] AWSStream response:', data);
                
                if (data && data.videoSource) {
                    var videoUrl = data.videoSource;
                    console.log('[ToonStream] Found video URL:', videoUrl);
                    
                    resolve([{
                        url: videoUrl,
                        quality: '1080p',
                        serverType: isZephyrflick ? 'Zephyrflick' : 'AWSStream',
                        headers: {
                            'Referer': mainUrl,
                            'User-Agent': HEADERS['User-Agent'],
                            'Accept': 'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5'
                        }
                    }]);
                } else {
                    console.log('[ToonStream] No videoSource in response');
                    resolve([]);
                }
            })
            .catch(function (error) {
                console.error('[ToonStream] AWSStream extraction error:', error);
                resolve([]);
            });
        } catch (error) {
            console.error('[ToonStream] AWSStream error:', error);
            resolve([]);
        }
    });
}

// Extract from embed page
function extractFromEmbedPage(embedUrl) {
    return new Promise(function (resolve) {
        console.log('[ToonStream] Processing embed page:', embedUrl);
        
        fetchRequest(embedUrl).then(function (html) {
            // Check if this is AWSStream/Zephyrflick
            if (embedUrl.includes('awstream.net') || embedUrl.includes('zephyrflick.top')) {
                return extractAWSStreamVideo(embedUrl).then(resolve);
            }
            
            // Look for nested iframe
            var iframeMatch = html.match(/<iframe[^>]*src="([^"]+)"[^>]*>/i);
            if (iframeMatch) {
                var nestedUrl = iframeMatch[1];
                console.log('[ToonStream] Found nested iframe:', nestedUrl);
                
                // Fix URL if relative
                if (nestedUrl.startsWith('//')) {
                    nestedUrl = 'https:' + nestedUrl;
                } else if (nestedUrl.startsWith('/')) {
                    var baseDomain = embedUrl.match(/https?:\/\/[^\/]+/)[0];
                    nestedUrl = baseDomain + nestedUrl;
                }
                
                // Recursively extract
                return extractFromEmbedPage(nestedUrl).then(resolve);
            }
            
            // Look for direct m3u8 URLs
            var m3u8Matches = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8)/gi);
            var streams = [];
            
            if (m3u8Matches) {
                console.log('[ToonStream] Found direct m3u8 URLs:', m3u8Matches.length);
                
                for (var i = 0; i < m3u8Matches.length; i++) {
                    var url = m3u8Matches[i];
                    streams.push({
                        url: url,
                        quality: extractQualityFromUrl(url),
                        serverType: 'Direct',
                        headers: {
                            'Referer': embedUrl,
                            'User-Agent': HEADERS['User-Agent']
                        }
                    });
                }
            }
            
            resolve(streams);
        }).catch(function (error) {
            console.error('[ToonStream] Embed page error:', error);
            resolve([]);
        });
    });
}

// Extract quality from URL
function extractQualityFromUrl(url) {
    var patterns = [
        /(\d{3,4})p/i,
        /quality[_-]?(\d{3,4})/i
    ];
    
    for (var i = 0; i < patterns.length; i++) {
        var match = url.match(patterns[i]);
        if (match) {
            var q = parseInt(match[1]);
            if (q >= 240 && q <= 4320) return q + 'p';
        }
    }
    
    return 'Unknown';
}

// Load season episodes via AJAX (for cartoons series)
function loadSeasonEpisodes(dataPost, dataSeason, targetEpisode) {
    return new Promise(function (resolve) {
        console.log('[ToonStream] Loading season:', { dataPost: dataPost, dataSeason: dataSeason });
        
        var formData = new URLSearchParams();
        formData.append('action', 'action_select_season');
        formData.append('season', dataSeason);
        formData.append('post', dataPost);
        
        fetch(AJAX_URL, {
            method: 'POST',
            headers: Object.assign({}, HEADERS, {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest'
            }),
            body: formData.toString()
        })
        .then(function (response) { return response.text(); })
        .then(function (seasonHtml) {
            console.log('[ToonStream] Season HTML length:', seasonHtml.length);
            
            // Parse episode links
            var episodeRegex = /<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?Episode\s+(\d+)[\s\S]*?<\/a>/gi;
            var episodeMatch;
            var episodes = [];
            
            while ((episodeMatch = episodeRegex.exec(seasonHtml)) !== null) {
                var episodeUrl = episodeMatch[1];
                var episodeNum = parseInt(episodeMatch[2]);
                
                // Fix URL if needed
                if (episodeUrl && !episodeUrl.startsWith('http')) {
                    episodeUrl = episodeUrl.startsWith('//') ? 'https:' + episodeUrl : MAIN_URL + episodeUrl;
                }
                
                episodes.push({
                    url: episodeUrl,
                    number: episodeNum
                });
            }
            
            console.log('[ToonStream] Found episodes:', episodes.length);
            
            // Find target episode or use first one
            var targetEp = episodes[0];
            if (targetEpisode) {
                for (var i = 0; i < episodes.length; i++) {
                    if (episodes[i].number === targetEpisode) {
                        targetEp = episodes[i];
                        break;
                    }
                }
            }
            
            if (targetEp) {
                console.log('[ToonStream] Selected episode:', targetEp);
                resolve(targetEp.url);
            } else {
                console.log('[ToonStream] No episode found');
                resolve(null);
            }
        })
        .catch(function (error) {
            console.error('[ToonStream] Season load error:', error);
            resolve(null);
        });
    });
}

// Extract streams from a ToonStream content page
function extractStreamsFromContentPage(pageUrl, season, episode) {
    return new Promise(function (resolve) {
        console.log('[ToonStream] Loading content page:', pageUrl);
        
        fetchRequest(pageUrl).then(function (html) {
            var streams = [];
            
            // Check if it's a series with seasons
            var seasonLinksMatch = html.match(/<div[^>]*aa-drp[^>]*choose-season[^>]*>/i);
            var isSeries = pageUrl.includes('/series/') || seasonLinksMatch;
            
            if (isSeries && season) {
                console.log('[ToonStream] Detected series with season:', season);
                
                // Find season data
                var seasonRegex = /<a[^>]*data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>[\s\S]*?Season\s+(\d+)[\s\S]*?<\/a>/gi;
                var seasonMatch;
                var foundSeason = null;
                
                while ((seasonMatch = seasonRegex.exec(html)) !== null) {
                    var seasonNum = parseInt(seasonMatch[3]);
                    if (seasonNum === season) {
                        foundSeason = {
                            dataPost: seasonMatch[1],
                            dataSeason: seasonMatch[2]
                        };
                        break;
                    }
                }
                
                if (foundSeason) {
                    // Load episodes for this season
                    return loadSeasonEpisodes(foundSeason.dataPost, foundSeason.dataSeason, episode)
                        .then(function (episodeUrl) {
                            if (episodeUrl) {
                                // Extract from episode page
                                return extractStreamsFromContentPage(episodeUrl);
                            }
                            resolve([]);
                        });
                }
            }
            
            // Extract iframe embeds (for both movies and episodes)
            var iframeRegex = /<iframe[^>]*data-src="([^"]+)"[^>]*>/gi;
            var iframeMatch;
            var embedPromises = [];
            
            while ((iframeMatch = iframeRegex.exec(html)) !== null) {
                var embedUrl = iframeMatch[1];
                console.log('[ToonStream] Found embed:', embedUrl);
                
                embedPromises.push(
                    extractFromEmbedPage(embedUrl).then(function (embedStreams) {
                        streams = streams.concat(embedStreams);
                    })
                );
            }
            
            // Wait for all embeds to be processed
            Promise.all(embedPromises).then(function () {
                console.log('[ToonStream] Total streams found:', streams.length);
                resolve(streams);
            });
        }).catch(function (error) {
            console.error('[ToonStream] Content page error:', error);
            resolve([]);
        });
    });
}

// Format streams for Nuvio
function formatToNuvioStreams(streams, mediaTitle) {
    var links = [];
    
    for (var i = 0; i < streams.length; i++) {
        var s = streams[i];
        
        links.push({
            name: 'ToonStream - ' + (s.serverType || 'Unknown') + ' - ' + (s.quality || 'Unknown'),
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
    
    // Remove duplicates
    var uniqueLinks = [];
    var seenUrls = {};
    
    for (var j = 0; j < links.length; j++) {
        if (!seenUrls[links[j].url]) {
            seenUrls[links[j].url] = true;
            uniqueLinks.push(links[j]);
        }
    }
    
    // Sort by quality
    var order = { '4K': 7, '2160p': 7, '1440p': 6, '1080p': 5, '720p': 4, '480p': 3, '360p': 2, '240p': 1, 'Unknown': 0 };
    uniqueLinks.sort(function (a, b) { return (order[b.quality] || 0) - (order[a.quality] || 0); });
    
    return uniqueLinks;
}

// Main Nuvio function - CARTOON FOCUSED
function getStreams(tmdbId, mediaType, season, episode) {
    var rid = createRequestId();
    logRid(rid, 'getStreams start (CARTOON MODE)', { 
        tmdbId: tmdbId, 
        mediaType: mediaType, 
        season: season, 
        episode: episode 
    });
    
    var mediaInfo = null;
    
    // Step 1: Get cartoon details from TMDB
    return getTMDBDetails(tmdbId, mediaType)
        .then(function (tmdbData) {
            if (!tmdbData || !tmdbData.title) {
                throw new Error('Could not get TMDB details for cartoon');
            }
            
            mediaInfo = tmdbData;
            logRid(rid, 'TMDB cartoon details', { 
                title: tmdbData.title, 
                year: tmdbData.year,
                genres: tmdbData.genres 
            });
            
            // Step 2: DIRECT SEARCH on ToonStream (no MAL/AniList!)
            var searchQuery = tmdbData.title;
            
            // Add year for better matching
            if (tmdbData.year) {
                searchQuery += ' ' + tmdbData.year;
            }
            
            logRid(rid, 'Searching ToonStream directly for cartoon:', searchQuery);
            return searchToonStreamDirect(searchQuery);
        })
        .then(function (searchResults) {
            if (!searchResults || searchResults.length === 0) {
                logRid(rid, 'No cartoon results found on ToonStream');
                throw new Error('Cartoon not found on ToonStream');
            }
            
            logRid(rid, 'Cartoon search results', { count: searchResults.length });
            
            // Find best match (simple title matching)
            var bestMatch = searchResults[0];
            var searchTitle = mediaInfo.title.toLowerCase();
            
            for (var i = 0; i < searchResults.length; i++) {
                var resultTitle = searchResults[i].title.toLowerCase();
                if (resultTitle.includes(searchTitle) || searchTitle.includes(resultTitle)) {
                    bestMatch = searchResults[i];
                    break;
                }
            }
            
            logRid(rid, 'Selected cartoon match', { 
                title: bestMatch.title, 
                url: bestMatch.url, 
                type: bestMatch.type 
            });
            
            // Step 3: Extract streams from cartoon page
            return extractStreamsFromContentPage(bestMatch.url, season, episode);
        })
        .then(function (streams) {
            logRid(rid, 'Extracted cartoon streams', { count: streams.length });
            
            // Build media title
            var mediaTitle = mediaInfo.title;
            if (mediaType === 'tv') {
                if (season && episode) {
                    var s = String(season).padStart(2, '0');
                    var e = String(episode).padStart(2, '0');
                    mediaTitle = mediaInfo.title + ' S' + s + 'E' + e;
                } else if (season) {
                    mediaTitle = mediaInfo.title + ' Season ' + season;
                }
            }
            
            if (mediaInfo.year) {
                mediaTitle += ' (' + mediaInfo.year + ')';
            }
            
            var formatted = formatToNuvioStreams(streams, mediaTitle);
            logRid(rid, 'Returning formatted cartoon streams', { count: formatted.length });
            
            return formatted;
        })
        .catch(function (err) {
            logRid(rid, 'CARTOON ERROR: ' + (err && err.message ? err.message : String(err)));
            return [];
        });
}

// Export for Nuvio
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.ToonStreamModule = { getStreams };
}
