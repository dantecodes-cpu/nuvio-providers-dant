// ToonStream Provider for Nuvio (Fixed based on Kotlin Source)
// Version: 2.0 (Deep Extraction + AWSStream Support)

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.one";
const AJAX_URL = "https://toonstream.one/wp-admin/admin-ajax.php";

console.log('[ToonStream] ✅ Provider loaded with Kotlin logic parity');

/**
 * Main Nuvio Entry Point
 */
async function getStreams(tmdbId, mediaType, season, episode) {
    console.log(`[ToonStream] Request: TMDB ${tmdbId} | ${mediaType} | S${season}E${episode}`);

    try {
        // 1. Get Title from TMDB
        const tmdbResp = await fetch(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`);
        const tmdbData = await tmdbResp.json();
        const title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;
        const year = (tmdbData.release_date || tmdbData.first_air_date || "").split("-")[0];

        if (!title) return [];
        console.log(`[ToonStream] Searching for: "${title}" (${year})`);

        // 2. Search ToonStream (Kotlin: line 65)
        const searchUrl = `${MAIN_URL}/page/1/?s=${encodeURIComponent(title)}`;
        const searchHtml = await fetchHtml(searchUrl);
        if (!searchHtml) return [];

        const results = parseSearchResults(searchHtml, title);
        if (results.length === 0) {
            console.log('[ToonStream] No search results found.');
            return [];
        }

        let targetUrl = results[0].url;
        console.log(`[ToonStream] Selected: ${targetUrl}`);

        // 3. Handle TV Episodes via AJAX (Kotlin: line 95)
        if (mediaType === 'tv' && season && episode) {
            const contentHtml = await fetchHtml(targetUrl);
            const epUrl = await getEpisodeUrlViaAjax(contentHtml, season, episode, targetUrl);
            if (!epUrl) {
                console.log('[ToonStream] Episode not found.');
                return [];
            }
            targetUrl = epUrl;
        }

        console.log(`[ToonStream] Scraping media page: ${targetUrl}`);
        const finalPageHtml = await fetchHtml(targetUrl);
        if (!finalPageHtml) return [];

        // 4. Extract Internal Embeds (Kotlin: line 128 "loadLinks")
        // Toonstream hides the real host inside a local iframe with 'data-src'
        const embedUrls = extractDataSrcLinks(finalPageHtml);
        
        const finalStreams = [];

        // 5. Resolve Embeds to Real Hosts (Kotlin: line 131)
        for (const embed of embedUrls) {
            const realHost = await resolvePhisherLink(embed);
            if (realHost) {
                console.log(`[ToonStream] Found Host: ${realHost}`);
                
                // 6. Extract M3U8 from Hosts (Kotlin: AWSStream Class)
                if (realHost.includes('awstream') || realHost.includes('zephyrflick')) {
                    const m3u8 = await extractAWSStream(realHost);
                    if (m3u8) {
                        finalStreams.push({
                            name: "ToonStream (HLS)",
                            type: "url", // Direct playable link
                            url: m3u8,
                            title: `Stream ${finalStreams.length + 1} (1080p)`
                        });
                    }
                } else if (realHost.includes('m3u8')) {
                    finalStreams.push({
                        name: "ToonStream (Direct)",
                        type: "url",
                        url: realHost,
                        title: "Direct HLS"
                    });
                } else {
                    // Fallback for supported iframe players (Vidhide, etc)
                    finalStreams.push({
                        name: "ToonStream (Embed)",
                        type: "iframe",
                        url: realHost,
                        title: "Embed"
                    });
                }
            }
        }

        console.log(`[ToonStream] ✅ Total streams: ${finalStreams.length}`);
        return finalStreams;

    } catch (e) {
        console.error('[ToonStream] Error:', e.message);
        return [];
    }
}

/* --- LOGIC HELPERS --- */

async function fetchHtml(url, referer = MAIN_URL) {
    try {
        const res = await fetch(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Referer': referer 
            }
        });
        return res.ok ? res.text() : null;
    } catch (e) { return null; }
}

function parseSearchResults(html, targetTitle) {
    const results = [];
    // Kotlin: #movies-a > ul > li -> article > a
    const re = /<article[^>]*>[\s\S]*?<a href="([^"]+)"[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/gi;
    let m;
    const normalizedTarget = targetTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

    while ((m = re.exec(html)) !== null) {
        const title = m[2].replace('Watch Online', '').trim();
        const normalizedFound = title.toLowerCase().replace(/[^a-z0-9]/g, '');
        // Simple fuzzy match
        if (normalizedFound.includes(normalizedTarget) || normalizedTarget.includes(normalizedFound)) {
            results.push({ url: m[1], title });
        }
    }
    return results;
}

// Fixed based on Kotlin line 95: "action" to "action_select_season"
async function getEpisodeUrlViaAjax(html, season, episode, pageUrl) {
    // 1. Find Data attributes
    const seasonRe = new RegExp(`<a[^>]*data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>.*?Season\\s+${season}\\b`, 'i');
    const m = html.match(seasonRe);
    if (!m) return null;

    const [_, dataPost, dataSeason] = m;

    // 2. Prepare POST data
    const body = new URLSearchParams({
        action: 'action_select_season', // FIXED: Was _server in your code
        season: dataSeason,
        post: dataPost
    });

    // 3. Request Episodes
    const res = await fetch(AJAX_URL, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest', 
            'Referer': pageUrl 
        },
        body: body.toString()
    });

    const ajaxHtml = await res.text();
    
    // 4. Parse specific episode link
    // Logic: Look for text "Episode X" inside the returned HTML
    const epRe = new RegExp(`<a[^>]*href="([^"]+)"[^>]*>.*?Episode\\s+${episode}<`, 'i');
    const epM = ajaxHtml.match(epRe);
    
    // Fallback: sometimes it's just <span class="num-epi">1x1</span>
    if (!epM) {
        // Broad search for any link containing the episode number if strict match fails
        const fallbackRe = new RegExp(`<a[^>]*href="([^"]+)"[^>]*>.*?(?:Episode|E)\\s*0*${episode}\\b`, 'i');
        const fbM = ajaxHtml.match(fallbackRe);
        return fbM ? fbM[1] : null;
    }

    return epM[1];
}

// Kotlin: document.select("#aa-options > div > iframe")
function extractDataSrcLinks(html) {
    const links = [];
    // Regex to capture <iframe ... data-src="..."> inside the options div
    const re = /data-src="([^"]+)"/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        // Decode HTML entities
        links.push(m[1].replace(/&#038;/g, '&'));
    }
    return links;
}

// Kotlin: "Phisher" logic - fetches the data-src to find the real iframe src
async function resolvePhisherLink(localEmbedUrl) {
    const html = await fetchHtml(localEmbedUrl);
    if (!html) return null;

    // Find the real iframe src inside the local embed
    const re = /<iframe[^>]*src="([^"]+)"/i;
    const m = html.match(re);
    if (m) {
        let url = m[1];
        if (url.startsWith('//')) url = 'https:' + url;
        return url;
    }
    return null;
}

// Ported from Kotlin: class AWSStream / class Zephyrflick
async function extractAWSStream(url) {
    try {
        const hash = url.split('/').pop().split('?')[0]; // Extract hash from URL
        const domain = new URL(url).origin;
        
        // AWSStream/Zephyr API Endpoint
        const apiUrl = `${domain}/player/index.php?data=${hash}&do=getVideo`;
        
        const body = new URLSearchParams({
            hash: hash,
            r: MAIN_URL
        });

        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            },
            body: body.toString()
        });

        const json = await res.json();
        
        // Return the master playlist if available
        if (json && json.videoSource) {
            return json.videoSource;
        }
    } catch (e) {
        console.log('AWS Extraction failed', e.message);
    }
    return null;
}

// Nuvio Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
