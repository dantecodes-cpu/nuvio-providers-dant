// Toonstream Provider
console.log("[Toonstream] Initializing provider");

const TOONSTREAM_BASE = "https://toonstream.one";
const BASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1"
};

// Utility functions
function makeRequest(url, options = {}) {
    return fetch(url, {
        ...options,
        headers: { ...BASE_HEADERS, ...options.headers },
        timeout: 10000
    }).then(response => {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
    });
}

// Get main page
function getMainPage(section = "series", page = 1) {
    console.log(`[Toonstream] Getting main page: ${section}, page ${page}`);
    
    const url = section === "series" || section === "movies" 
        ? `${TOONSTREAM_BASE}/${section}/page/${page}/`
        : `${TOONSTREAM_BASE}/${section}/page/${page}/`;
    
    return makeRequest(url)
        .then(response => response.text())
        .then(html => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            const items = doc.querySelectorAll('#movies-a > ul > li');
            const results = [];
            
            items.forEach(item => {
                const titleElement = item.querySelector('article > header > h2');
                const linkElement = item.querySelector('article > a');
                const imgElement = item.querySelector('article > div.post-thumbnail > figure > img');
                
                if (titleElement && linkElement) {
                    const title = titleElement.textContent.trim().replace('Watch Online', '');
                    const href = linkElement.getAttribute('href');
                    let posterUrl = imgElement ? imgElement.getAttribute('src') : '';
                    
                    // Fix poster URL
                    if (posterUrl && !posterUrl.startsWith('http')) {
                        posterUrl = 'https:' + posterUrl;
                    }
                    
                    results.push({
                        title: title,
                        url: href,
                        poster: posterUrl,
                        type: section.includes('movie') ? 'movie' : (section.includes('anime') || section.includes('cartoon') ? 'anime' : 'series')
                    });
                }
            });
            
            console.log(`[Toonstream] Found ${results.length} items`);
            return results;
        });
}

// Search content
function searchContent(query) {
    console.log(`[Toonstream] Searching for: ${query}`);
    
    const searchResults = [];
    
    const searchPage = (page) => {
        return makeRequest(`${TOONSTREAM_BASE}/page/${page}/?s=${encodeURIComponent(query)}`)
            .then(response => response.text())
            .then(html => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                
                const items = doc.querySelectorAll('#movies-a > ul > li');
                
                if (items.length === 0) {
                    return searchResults; // No more results
                }
                
                items.forEach(item => {
                    const titleElement = item.querySelector('article > header > h2');
                    const linkElement = item.querySelector('article > a');
                    const imgElement = item.querySelector('article figure img');
                    
                    if (titleElement && linkElement) {
                        const title = titleElement.textContent.trim().replace('Watch Online', '');
                        const href = linkElement.getAttribute('href');
                        let posterUrl = imgElement ? imgElement.getAttribute('src') : '';
                        
                        // Fix poster URL
                        if (posterUrl && !posterUrl.startsWith('http')) {
                            posterUrl = 'https:' + posterUrl;
                        }
                        
                        // Avoid duplicates
                        if (!searchResults.some(item => item.url === href)) {
                            searchResults.push({
                                title: title,
                                url: href,
                                poster: posterUrl,
                                type: href.includes('/series/') ? 'series' : 'movie'
                            });
                        }
                    }
                });
                
                // If we have results, try next page
                if (items.length > 0 && page < 3) {
                    return searchPage(page + 1);
                }
                
                return searchResults;
            });
    };
    
    return searchPage(1);
}

// Load content details
function loadContent(url) {
    console.log(`[Toonstream] Loading content: ${url}`);
    
    return makeRequest(url)
        .then(response => response.text())
        .then(html => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // Extract basic info
            const titleElement = doc.querySelector('header.entry-header > h1');
            const posterElement = doc.querySelector('div.bghd > img');
            const descriptionElement = doc.querySelector('div.description > p');
            
            const title = titleElement ? titleElement.textContent.trim().replace('Watch Online', '') : 'Unknown';
            const posterUrlRaw = posterElement ? posterElement.getAttribute('src') : '';
            const poster = posterUrlRaw.startsWith('http') ? posterUrlRaw : 'https:' + posterUrlRaw;
            const description = descriptionElement ? descriptionElement.textContent.trim() : '';
            
            const isSeries = url.includes('/series/');
            
            if (isSeries) {
                // Load episodes
                const seasonElements = doc.querySelectorAll('div.aa-drp.choose-season > ul > li > a');
                const episodes = [];
                
                const loadSeason = (index) => {
                    if (index >= seasonElements.length) {
                        return Promise.resolve(episodes);
                    }
                    
                    const seasonElement = seasonElements[index];
                    const dataPost = seasonElement.getAttribute('data-post');
                    const dataSeason = seasonElement.getAttribute('data-season');
                    
                    console.log(`[Toonstream] Loading season ${dataSeason}`);
                    
                    // Make AJAX request for season episodes
                    const formData = new FormData();
                    formData.append('action', 'action_select_season');
                    formData.append('season', dataSeason);
                    formData.append('post', dataPost);
                    
                    return fetch(`${TOONSTREAM_BASE}/wp-admin/admin-ajax.php`, {
                        method: 'POST',
                        headers: {
                            'X-Requested-With': 'XMLHttpRequest',
                            ...BASE_HEADERS
                        },
                        body: formData
                    })
                    .then(response => response.text())
                    .then(seasonHtml => {
                        const seasonDoc = parser.parseFromString(seasonHtml, 'text/html');
                        const episodeElements = seasonDoc.querySelectorAll('article');
                        
                        episodeElements.forEach(episodeElement => {
                            const episodeLink = episodeElement.querySelector('article > a');
                            const episodeImg = episodeElement.querySelector('article > div.post-thumbnail > figure > img');
                            const episodeTitleElement = episodeElement.querySelector('article > header.entry-header > h2');
                            
                            if (episodeLink && episodeTitleElement) {
                                const episodeUrl = episodeLink.getAttribute('href');
                                const episodeTitle = episodeTitleElement.textContent.trim();
                                const episodePosterRaw = episodeImg ? episodeImg.getAttribute('src') : '';
                                const episodePoster = episodePosterRaw.startsWith('http') ? episodePosterRaw : 'https:' + episodePosterRaw;
                                
                                // Extract season and episode numbers
                                let seasonNumber = 1;
                                let episodeNumber = 1;
                                
                                // Try to parse from HTML or URL
                                const seasonMatch = seasonHtml.match(/<span class="num-epi">(\d+)x/);
                                if (seasonMatch) {
                                    seasonNumber = parseInt(seasonMatch[1]) || 1;
                                }
                                
                                const episodeMatch = episodeTitle.match(/Episode\s+(\d+)/i) || 
                                                    episodeUrl.match(/episode-(\d+)/i);
                                if (episodeMatch) {
                                    episodeNumber = parseInt(episodeMatch[1]) || 1;
                                }
                                
                                episodes.push({
                                    title: episodeTitle,
                                    url: episodeUrl,
                                    poster: episodePoster,
                                    season: seasonNumber,
                                    episode: episodeNumber,
                                    seasonId: dataSeason
                                });
                            }
                        });
                        
                        return loadSeason(index + 1);
                    });
                };
                
                return loadSeason(0).then(() => {
                    return {
                        title: title,
                        poster: poster,
                        description: description,
                        type: 'series',
                        episodes: episodes,
                        seasons: Array.from(new Set(episodes.map(ep => ep.season))).sort((a, b) => a - b)
                    };
                });
            } else {
                // Movie
                return {
                    title: title,
                    poster: poster,
                    description: description,
                    type: 'movie',
                    url: url
                };
            }
        });
}

// Extract streaming links
function getStreamingLinks(url) {
    console.log(`[Toonstream] Extracting streaming links: ${url}`);
    
    return makeRequest(url)
        .then(response => response.text())
        .then(html => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            const iframeElements = doc.querySelectorAll('#aa-options > div > iframe');
            const sources = [];
            
            const extractFromIframe = (index) => {
                if (index >= iframeElements.length) {
                    return Promise.resolve(sources);
                }
                
                const iframe = iframeElements[index];
                const dataSrc = iframe.getAttribute('data-src');
                
                if (!dataSrc) {
                    return extractFromIframe(index + 1);
                }
                
                console.log(`[Toonstream] Processing iframe source: ${dataSrc}`);
                
                return makeRequest(dataSrc)
                    .then(response => response.text())
                    .then(iframeHtml => {
                        const iframeDoc = parser.parseFromString(iframeHtml, 'text/html');
                        const nestedIframe = iframeDoc.querySelector('iframe');
                        
                        if (nestedIframe) {
                            const finalUrl = nestedIframe.getAttribute('src');
                            if (finalUrl) {
                                // Check which extractor to use based on URL
                                const extractorInfo = getExtractorForUrl(finalUrl);
                                
                                sources.push({
                                    url: finalUrl,
                                    extractor: extractorInfo.name,
                                    quality: extractorInfo.quality || 'HD',
                                    type: extractorInfo.type || 'unknown'
                                });
                                
                                console.log(`[Toonstream] Found source: ${extractorInfo.name}`);
                            }
                        }
                        
                        return extractFromIframe(index + 1);
                    })
                    .catch(error => {
                        console.log(`[Toonstream] Error processing iframe: ${error.message}`);
                        return extractFromIframe(index + 1);
                    });
            };
            
            return extractFromIframe(0).then(() => {
                return sources;
            });
        });
}

// Helper to determine extractor based on URL
function getExtractorForUrl(url) {
    const extractors = [
        { pattern: /streamsb\.net|sblongvu\.com|sbplay\.org/, name: 'StreamSB', quality: 'HD', type: 'hls' },
        { pattern: /vidmolyme\.xyz/, name: 'Vidmolyme', quality: 'HD', type: 'hls' },
        { pattern: /streamruby\.com/, name: 'Streamruby', quality: 'HD', type: 'hls' },
        { pattern: /d000d\.com/, name: 'DoodStream', quality: 'HD', type: 'mp4' },
        { pattern: /vidhidevip\.com/, name: 'Vidhide', quality: 'HD', type: 'hls' },
        { pattern: /cdnwish\.com/, name: 'StreamWish', quality: 'HD', type: 'hls' },
        { pattern: /filemoon\.nl/, name: 'FileMoon', quality: 'HD', type: 'hls' },
        { pattern: /cloudy\.upns\.one/, name: 'Cloudy', quality: 'HD', type: 'hls' },
        { pattern: /gd\.mirrorbot\./, name: 'GDMirrorbot', quality: 'HD', type: 'mp4' },
        { pattern: /emturbovid\./, name: 'Emturbovid', quality: 'HD', type: 'hls' },
        { pattern: /zephyrflick\.top/, name: 'Zephyrflick', quality: 'HD', type: 'hls' }
    ];
    
    for (const extractor of extractors) {
        if (extractor.pattern.test(url)) {
            return extractor;
        }
    }
    
    return { name: 'Unknown', quality: 'HD', type: 'unknown' };
}

// Main function to get streams (similar to PrimeVideo's getStreams)
function getStreams(title, year = null, type = "movie", season = null, episode = null) {
    console.log(`[Toonstream] Getting streams for: ${title}${year ? ` (${year})` : ''}${season ? ` S${season}E${episode}` : ''}`);
    
    return searchContent(title).then(searchResults => {
        if (searchResults.length === 0) {
            console.log('[Toonstream] No search results found');
            return [];
        }
        
        // Filter by type if specified
        let filteredResults = searchResults;
        if (type === 'series') {
            filteredResults = searchResults.filter(item => item.type === 'series');
        } else if (type === 'movie') {
            filteredResults = searchResults.filter(item => item.type === 'movie');
        }
        
        if (filteredResults.length === 0) {
            console.log('[Toonstream] No matching type found');
            return [];
        }
        
        // Find best match
        const bestMatch = findBestMatch(filteredResults, title, year);
        
        console.log(`[Toonstream] Selected: ${bestMatch.title}`);
        
        return loadContent(bestMatch.url).then(content => {
            if (type === 'series' && content.type === 'series') {
                // Find specific episode
                let targetEpisode = null;
                
                if (season && episode) {
                    targetEpisode = content.episodes.find(ep => 
                        ep.season === season && ep.episode === episode
                    );
                    
                    if (!targetEpisode) {
                        // Fallback to first episode of the season
                        targetEpisode = content.episodes.find(ep => ep.season === season);
                    }
                } else {
                    // Use first episode
                    targetEpisode = content.episodes[0];
                }
                
                if (targetEpisode) {
                    console.log(`[Toonstream] Using episode: ${targetEpisode.title}`);
                    return getStreamingLinks(targetEpisode.url);
                } else {
                    console.log('[Toonstream] Episode not found');
                    return [];
                }
            } else {
                // Movie
                return getStreamingLinks(bestMatch.url);
            }
        });
    })
    .then(sources => {
        // Format streams for player
        const streams = sources.map(source => {
            return {
                name: `Toonstream (${source.extractor})`,
                title: `${title}${year ? ` (${year})` : ''} ${source.quality}`,
                url: source.url,
                quality: source.quality,
                type: source.type.includes('hls') ? 'hls' : 'direct',
                headers: {
                    "User-Agent": "Mozilla/5.0 (Linux; Android 13)",
                    "Accept": "*/*",
                    "Referer": "https://toonstream.one/"
                }
            };
        });
        
        console.log(`[Toonstream] Successfully processed ${streams.length} streams`);
        return streams;
    })
    .catch(error => {
        console.error(`[Toonstream] Error: ${error.message}`);
        return [];
    });
}

// Helper to find best match
function findBestMatch(results, query, year = null) {
    if (results.length === 1) return results[0];
    
    const queryLower = query.toLowerCase();
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
        
        // Year match
        if (year) {
            const yearMatch = result.title.match(/\b(19|20)\d{2}\b/);
            if (yearMatch && yearMatch[0] === year.toString()) {
                score += 50;
            }
        }
        
        return { result, score };
    });
    
    scoredResults.sort((a, b) => b.score - a.score);
    return scoredResults[0].result;
}

// Export functions
if (typeof module !== "undefined" && module.exports) {
    module.exports = { 
        getStreams,
        searchContent,
        loadContent,
        getStreamingLinks,
        getMainPage
    };
} else {
    window.Toonstream = { 
        getStreams,
        searchContent,
        loadContent,
        getStreamingLinks,
        getMainPage
    };
}

console.log("[Toonstream] Provider initialized successfully");
