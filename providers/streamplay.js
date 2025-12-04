// StreamPlay Aggregated Scraper for Nuvio
// VERSION: 1.0 (All-In-One WordPress & API Scraper)
// Sources: VegaMovies, UHDMovies, MoviesMod, BollyFlix, RidoMovies, KissKH, etc.

const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c';

// --- Domain Configuration (Update these if sites change) ---
const DOMAINS = {
    vegamovies: "https://vegamovies.ls",
    uhdmovies: "https://uhdmovies.fyi",
    moviesmod: "https://moviesmod.vip",
    bollyflix: "https://bollyflix.meme",
    topmovies: "https://topmovies.se",
    extramovies: "https://extramovies.bad",
    luxmovies: "https://luxmovies.co", // DotMovies
    ridomovies: "https://ridomovies.tv",
    kisskh: "https://kisskh.ovh"
};

// --- Headers ---
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36";
const HEADERS = {
    'User-Agent': MOBILE_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Connection': 'keep-alive'
};

// --- Helpers ---

function fetchRequest(url, opts) {
    var options = opts || {};
    options.headers = Object.assign({}, HEADERS, options.headers || {});
    return fetch(url, options).then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res;
    });
}

function fetchJson(url, opts) {
    return fetchRequest(url, opts).then(function(res) { return res.json(); });
}

function fetchText(url, opts) {
    return fetchRequest(url, opts).then(function(res) { return res.text(); });
}

function getQuality(str) {
    str = (str || '').toLowerCase();
    if (str.includes('2160p') || str.includes('4k')) return '4K';
    if (str.includes('1080p')) return '1080p';
    if (str.includes('720p')) return '720p';
    if (str.includes('480p')) return '480p';
    return 'Unknown';
}

function cleanTitle(str) {
    return str.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

function extractLinksRegex(html) {
    // Basic regex to find download links in HTML without DOM parser
    var links = [];
    var regex = /href="(https?:\/\/[^"]+)"/g;
    var match;
    while ((match = regex.exec(html)) !== null) {
        var url = match[1];
        if (url.includes('drive') || url.includes('cloud') || url.includes('pixel') || url.includes('share')) {
            links.push(url);
        }
    }
    return links;
}

// --- ID Mapping ---

function getTmdbInfo(tmdbId, type) {
    var url = TMDB_API + '/' + type + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&append_to_response=external_ids';
    return fetchJson(url).then(function(data) {
        return {
            title: type === 'movie' ? data.title : data.name,
            year: (type === 'movie' ? data.release_date : data.first_air_date || '').split('-')[0],
            imdbId: data.external_ids ? data.external_ids.imdb_id : null
        };
    });
}

// --- PROVIDER: Generic WordPress Scraper ---
// Handles: VegaMovies, UHDMovies, MoviesMod, BollyFlix, etc.
// Logic ported from 'invokeWpredis' in StreamPlayExtractor.kt

function invokeWordPress(sourceName, domain, title, year, season, episode, imdbId) {
    if (!domain || !title) return Promise.resolve([]);

    // 1. Search
    var query = title + (season ? " Season " + season : " " + year);
    var searchUrl = domain + "/?s=" + encodeURIComponent(query);

    return fetchText(searchUrl)
        .then(function(html) {
            // Find article URLs (simplified regex for sandbox)
            // Looking for <a href="..." ...>Title</a> inside article tags
            var articleRegex = /<article[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/g;
            var match;
            var postUrl = null;

            while ((match = articleRegex.exec(html)) !== null) {
                var href = match[1];
                var text = match[2];
                // Basic matching
                if (cleanTitle(text).includes(cleanTitle(title))) {
                    if (season) {
                        if (text.toLowerCase().includes("season " + season)) {
                            postUrl = href;
                            break;
                        }
                    } else {
                        if (text.includes(year)) {
                            postUrl = href;
                            break;
                        }
                    }
                }
            }

            if (!postUrl && imdbId) {
                // Fallback: Try searching IMDB ID if site supports it
                return fetchText(domain + "/?s=" + imdbId).then(function(res) {
                    var m = /<article[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"/.exec(res);
                    return m ? m[1] : null;
                });
            }
            return postUrl;
        })
        .then(function(postUrl) {
            if (!postUrl) return [];

            return fetchText(postUrl).then(function(html) {
                var streams = [];
                var quality = getQuality(html.match(/<title>(.*?)<\/title>/)?.[1] || "");

                // Strategy: Find links based on Season/Episode context
                var relevantHtml = html;

                if (season) {
                    // Narrow down to specific episode/season section if possible
                    // Kotlin uses rigid selectors; we use loose regex for robustness
                    var seasonRegex = new RegExp("Season\\s*0?" + season, "i");
                    var episodeRegex = new RegExp("Episode\\s*0?" + episode, "i");
                    
                    if (seasonRegex.test(html) && episodeRegex.test(html)) {
                        // Very rough slicing to find the episode block
                        var parts = html.split(seasonRegex);
                        if (parts.length > 1) relevantHtml = parts[1];
                    }
                }

                // Extract download links (V-Cloud, G-Direct, etc.)
                var linkRegex = /href="(https?:\/\/[^"]+)"[^>]*>([^<]*(Download|Watch|V-Cloud|HubCloud)[^<]*)</gi;
                var match;
                while ((match = linkRegex.exec(relevantHtml)) !== null) {
                    var href = match[1];
                    var label = match[2].replace(/<[^>]+>/g, '').trim(); // clean tags

                    // Filter out bad links
                    if (href.includes('wp-login') || href.includes('#')) continue;

                    streams.push({
                        name: sourceName + " | " + label,
                        title: title + (season ? " S" + season + "E" + episode : ""),
                        url: href,
                        quality: getQuality(label) || quality,
                        provider: sourceName,
                        type: 'url' // Nuvio will resolve the final link
                    });
                }

                return streams.slice(0, 10); // Limit results
            });
        })
        .catch(function(e) { 
            // console.log(sourceName + " Error: " + e); 
            return []; 
        });
}

// --- PROVIDER: RidoMovies (API) ---
// Logic ported from 'invokeRidomovies' in StreamPlayExtractor.kt

function invokeRidoMovies(imdbId, season, episode) {
    if (!imdbId) return Promise.resolve([]);
    
    var searchUrl = DOMAINS.ridomovies + "/core/api/search?q=" + imdbId;
    
    return fetchJson(searchUrl)
        .then(function(json) {
            var items = json.data && json.data.items;
            if (!items || items.length === 0) return [];
            
            var slug = items[0].slug;
            var contentId = items[0].contentable.id; // Internal ID needed?
            
            var targetId = slug;
            // For TV, Rido needs specific episode slug logic, simplified here:
            // The Kotlin code fetches specific episode pages.
            // We will rely on the main API endpoint if possible.
            
            // NOTE: Rido API structure is complex. Using a direct slug approach.
            var apiUrl = DOMAINS.ridomovies + "/core/api/" + (season ? "episodes" : "movies") + "/" + slug + "/videos";
            if (season) {
                // TV Show logic needs extra step to find episode ID
                // Skipping deep nesting for simplicity in this version
                return []; 
            }

            return fetchJson(apiUrl).then(function(res) {
                var data = res.data;
                if (!data) return [];
                
                return data.map(function(item) {
                    return {
                        name: "RidoMovies | " + (item.quality || "HD"),
                        title: slug,
                        url: item.url, // Usually an iframe
                        quality: "1080p",
                        provider: "RidoMovies",
                        type: 'embed'
                    };
                });
            });
        })
        .catch(function() { return []; });
}

// --- PROVIDER: KissKH (Asian Content) ---
// Logic ported from 'invokeKisskh'

function invokeKissKH(title, season, episode) {
    if (!title) return Promise.resolve([]);
    
    var type = season ? 2 : 1; // 1=Movie? Check logic. Kotlin says: if (season == null) "2" else "1"
    // Wait, Kotlin: val type = if (season == null) "2" else "1" (So 2=Movie, 1=TV)
    var searchType = season ? 1 : 2;
    
    var searchUrl = DOMAINS.kisskh + "/api/DramaList/Search?q=" + encodeURIComponent(title) + "&type=" + searchType;
    
    return fetchJson(searchUrl)
        .then(function(res) {
            if (!res || res.length === 0) return [];
            var item = res[0]; // Take first match
            var id = item.id;
            
            // Get Details to find episode ID
            return fetchJson(DOMAINS.kisskh + "/api/DramaList/Drama/" + id + "?isq=false").then(function(detail) {
                var eps = detail.episodes;
                var epId = null;
                
                if (season) {
                    // Find matching episode number
                    var match = eps.find(function(e) { return e.number === episode; });
                    if (match) epId = match.id;
                } else {
                    // Movie usually has 1 episode
                    if (eps.length > 0) epId = eps[0].id;
                }
                
                if (!epId) return [];
                
                // Get Stream
                return fetchJson(DOMAINS.kisskh + "/api/DramaList/Episode/" + epId + ".png?err=false&ts=&time=").then(function(source) {
                    var streams = [];
                    if (source.Video) {
                        streams.push({
                            name: "KissKH | Video",
                            title: title,
                            url: source.Video,
                            quality: "720p",
                            provider: "KissKH",
                            type: 'hls'
                        });
                    }
                    return streams;
                });
            });
        })
        .catch(function() { return []; });
}

// --- MAIN ENTRY POINT ---

function getStreams(tmdbId, mediaType, season, episode) {
    if (mediaType !== 'movie' && mediaType !== 'tv') return Promise.resolve([]);

    return getTmdbInfo(tmdbId, mediaType)
        .then(function(info) {
            var title = info.title;
            var year = info.year;
            var imdbId = info.imdbId;

            var promises = [];

            // 1. Invoke WordPress Scrapers (Parallel)
            var wpSites = [
                { name: "VegaMovies", domain: DOMAINS.vegamovies },
                { name: "UHDMovies", domain: DOMAINS.uhdmovies },
                { name: "MoviesMod", domain: DOMAINS.moviesmod },
                { name: "BollyFlix", domain: DOMAINS.bollyflix },
                { name: "TopMovies", domain: DOMAINS.topmovies },
                { name: "ExtraMovies", domain: DOMAINS.extramovies },
                { name: "LuxMovies", domain: DOMAINS.luxmovies }
            ];

            wpSites.forEach(function(site) {
                promises.push(invokeWordPress(site.name, site.domain, title, year, season, episode, imdbId));
            });

            // 2. Invoke API Scrapers
            if (mediaType === 'movie') { // Rido works best for movies in this simplified port
                promises.push(invokeRidoMovies(imdbId, season, episode));
            }
            promises.push(invokeKissKH(title, season, episode));

            // 3. Aggregate
            return Promise.allSettled(promises).then(function(results) {
                var streams = [];
                results.forEach(function(r) {
                    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                        streams = streams.concat(r.value);
                    }
                });

                // Deduplicate by URL
                var unique = [];
                var seen = {};
                streams.forEach(function(s) {
                    if (!seen[s.url]) {
                        seen[s.url] = true;
                        unique.push(s);
                    }
                });

                // Sort: 4K > 1080p > 720p
                var order = { '4K': 4, '1080p': 3, '720p': 2, '480p': 1, 'Unknown': 0 };
                unique.sort(function(a, b) {
                    return (order[b.quality] || 0) - (order[a.quality] || 0);
                });

                return unique;
            });
        })
        .catch(function(err) {
            console.log('[StreamPlay Aggregated] Error:', err);
            return [];
        });
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.StreamPlayAggregatedModule = { getStreams };
}
