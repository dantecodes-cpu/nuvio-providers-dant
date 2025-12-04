// Vidsrc.cc Scraper for Nuvio
// Ported from StreamPlay (StreamPlayExtractor.kt)

const VIDSRC_API = "https://vidsrc.cc";
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': `${VIDSRC_API}/`,
    'X-Requested-With': 'XMLHttpRequest'
};

// --- Helpers ---
function createRequestId() { return Math.random().toString(36).slice(2, 8); }
function logRid(rid, msg) { try { console.log(`[Vidsrc][${rid}] ${msg}`); } catch(e){} }

function getJson(url) {
    return fetch(url, { headers: HEADERS }).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    });
}

function getText(url) {
    return fetch(url, { headers: HEADERS }).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
    });
}

// --- Main Logic ---

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    return new Promise((resolve, reject) => {
        const rid = createRequestId();
        
        // 1. Get TMDB Details (Verify ID)
        getJson(`${TMDB_BASE_URL}/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`)
        .then(meta => {
            const title = meta.title || meta.name;
            logRid(rid, `Processing: ${title}`);

            // 2. Construct Embed URL
            // Source: StreamPlayExtractor.kt line 499-500
            let url;
            if (mediaType === 'movie') {
                url = `${VIDSRC_API}/v2/embed/movie/${tmdbId}?autoPlay=false`;
            } else {
                url = `${VIDSRC_API}/v2/embed/tv/${tmdbId}/${seasonNum}/${episodeNum}?autoPlay=false`;
            }

            return getText(url);
        })
        .then(html => {
            // 3. Extract Internal Variables
            // Source: StreamPlayExtractor.kt line 502
            // Kotlin uses: Regex("""var\s+(\w+)\s*=\s*(?:"([^"]*)"|(\w+));""")
            
            const extract = (name) => {
                const regex = new RegExp(`var\\s+${name}\\s*=\\s*["']([^"']+)["']`);
                const match = html.match(regex);
                return match ? match[1] : null;
            };

            const internalId = extract("id"); // This is the crucial internal ID
            const movieType = extract("movieType");
            
            // Note: The Kotlin code generates a VRF using AES here.
            // In a JS sandbox without crypto libraries, we attempt the request without it 
            // or rely on the internal ID which is the primary key.
            
            if (!internalId) {
                logRid(rid, "Internal ID not found");
                resolve([]);
                return;
            }

            // 4. Fetch Servers
            // Source: StreamPlayExtractor.kt line 504
            let api = `${VIDSRC_API}/api/${internalId}/servers?id=${internalId}&type=${movieType}`;
            if (mediaType === 'tv') {
                api += `&season=${seasonNum}&episode=${episodeNum}`;
            }

            return getJson(api);
        })
        .then(json => {
            const data = (json && json.data) ? json.data : [];
            if (data.length === 0) {
                resolve([]);
                return;
            }

            // 5. Fetch Source for each server
            // Source: StreamPlayExtractor.kt line 505
            const promises = data.map(server => {
                // Skip if no hash (unlikely)
                if (!server.hash) return null;

                return getJson(`${VIDSRC_API}/api/source/${server.hash}`)
                    .then(srcJson => {
                        // Source: StreamPlayExtractor.kt line 506
                        if (srcJson.data && srcJson.data.source) {
                            const sourceUrl = srcJson.data.source;
                            // Filter out error pages
                            if (sourceUrl.includes(".vidbox")) return null;

                            return {
                                name: `Vidsrc.cc - ${server.name}`,
                                title: server.name,
                                url: sourceUrl,
                                quality: server.name.includes("4K") ? "4K" : "1080p", // Source: line 507
                                provider: "vidsrccc",
                                headers: { "Referer": VIDSRC_API } // Source: line 508
                            };
                        }
                    })
                    .catch(() => null);
            });

            return Promise.all(promises);
        })
        .then(results => {
            if (results) resolve(results.filter(Boolean));
            else resolve([]);
        })
        .catch(e => {
            logRid(rid, e.message);
            resolve([]);
        });
    });
}

if (typeof module !== 'undefined') module.exports = { getStreams };
else global.getStreams = getStreams;
