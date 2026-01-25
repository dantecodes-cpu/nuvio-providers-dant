// ToonStream Provider for Nuvio
// Version: 10.0 (VidStack API Fix + GDMirror Support)

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.one";
const USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        // 1. TMDB & SEARCH
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const tmdbResp = await req(tmdbUrl);
        const tmdbData = JSON.parse(tmdbResp);
        
        let title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;
        const cleanTitle = title.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
        
        const searchUrl = `${MAIN_URL}/page/1/?s=${encodeURIComponent(cleanTitle)}`;
        const searchHtml = await req(searchUrl);
        if (!searchHtml) return [];

        const results = [];
        const articles = searchHtml.split('<article');
        
        for (const article of articles) {
            if (!article.includes('href=')) continue;
            const urlMatch = article.match(/href="([^"]+)"/);
            const titleMatch = article.match(/<h[2-3][^>]*>([^<]+)<\/h[2-3]>/);
            if (urlMatch && titleMatch) {
                let rawUrl = urlMatch[1];
                if (!rawUrl.startsWith('http')) rawUrl = MAIN_URL + rawUrl;
                const rawTitle = titleMatch[1].replace('Watch Online', '').trim();
                if (rawUrl.includes('/movies/') || rawUrl.includes('/series/')) {
                    results.push({ url: rawUrl, title: rawTitle });
                }
            }
        }

        const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
        const target = normalize(title);
        
        let match = results.find(r => normalize(r.title) === target);
        if (!match) {
            const slugTarget = cleanTitle.toLowerCase().replace(/\s+/g, '-');
            match = results.find(r => r.url.toLowerCase().includes(slugTarget));
        }
        if (!match) match = results.find(r => normalize(r.title).startsWith(target));

        if (!match) return [];
        let contentUrl = match.url;

        // 2. TV EPISODE LOGIC
        if (mediaType === 'tv') {
            const pageHtml = await req(contentUrl);
            const seasonRegex = new RegExp(`data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>.*?Season\\s*${season}\\b`, 'i');
            const sMatch = pageHtml.match(seasonRegex);

            if (!sMatch) return [];

            const postId = sMatch[1];
            const seasonId = sMatch[2];
            const ajaxUrl = `${MAIN_URL}/wp-admin/admin-ajax.php`;
            const formData = `action=action_select_season&season=${seasonId}&post=${postId}`;
            
            const ajaxHtml = await req(ajaxUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': contentUrl
                },
                body: formData
            });

            const epRegex = /<span class="num-epi">(\d+)x(\d+)<\/span>[\s\S]*?<a href="([^"]+)"/gi;
            let epMatch, foundEpUrl = null;
            while ((epMatch = epRegex.exec(ajaxHtml)) !== null) {
                if (parseInt(epMatch[1]) == season && parseInt(epMatch[2]) == episode) {
                    foundEpUrl = epMatch[3];
                    break;
                }
            }

            if (!foundEpUrl) return [];
            contentUrl = foundEpUrl;
        }

        // 3. EXTRACT PLAYERS
        const playerHtml = await req(contentUrl);
        const embedRegex = /(?:data-src|src)="([^"]*toonstream\.one\/home\/\?trembed=[^"]+)"/gi;
        const matches = [...playerHtml.matchAll(embedRegex)];
        
        const streams = [];
        const processedUrls = new Set();

        for (const m of matches.slice(0, 16)) {
            try {
                const embedUrl = m[1].replace(/&#038;/g, '&');
                const realUrl = await resolveRedirect(embedUrl, contentUrl);
                
                if (!realUrl || processedUrls.has(realUrl)) continue;
                processedUrls.add(realUrl);
                
                let extracted = false;

                // A. AWSStream / Zephyr
                if (realUrl.includes('awstream') || realUrl.includes('zephyrflick')) {
                    const res = await extractAWSStream(realUrl);
                    if (res) { streams.push(res); extracted = true; }
                }

                // B. VidStack API (Cloudy, StreamUp) - Now with 'r' param
                if (!extracted && (realUrl.includes('cloudy') || realUrl.includes('strmup'))) {
                    const res = await extractVidStackAPI(realUrl);
                    if (res && res.length > 0) {
                        streams.push(...res);
                        extracted = true;
                    }
                }

                // C. StreamRuby
                if (!extracted && (realUrl.includes('rubystm') || realUrl.includes('streamruby'))) {
                    const cleanUrl = realUrl.replace('/e/', '/').replace('.html', '');
                    const genericLinks = await extractUniversal(cleanUrl);
                    if (genericLinks.length > 0) {
                        streams.push(...genericLinks);
                        extracted = true;
                    }
                }

                // D. GDMirror (New Script Scraper)
                if (!extracted && realUrl.includes('gdmirror')) {
                    const res = await extractUniversal(realUrl);
                    if (res.length > 0) {
                        streams.push(...res);
                        extracted = true;
                    }
                }

                // E. Universal Fallback
                if (!extracted) {
                    const genericLinks = await extractUniversal(realUrl);
                    if (genericLinks.length > 0) {
                        streams.push(...genericLinks);
                        extracted = true;
                    }
                }

            } catch (err) { }
        }

        return streams;

    } catch (e) {
        return [];
    }
}

// ==========================================================
// HELPERS
// ==========================================================

async function req(url, opts = {}) {
    const headers = { 
        'User-Agent': USER_AGENT, 
        'Referer': MAIN_URL, 
        ...opts.headers 
    };
    const response = await fetch(url, { ...opts, headers });
    return response.ok ? response.text() : null;
}

async function resolveRedirect(url, referer) {
    const html = await req(url, { headers: { Referer: referer } });
    if (!html) return null;
    const match = html.match(/<iframe[^>]*src=["']([^"']+)["']/i);
    return match ? (match[1].startsWith('//') ? 'https:' + match[1] : match[1]) : null;
}

async function extractAWSStream(url) {
    try {
        const domain = new URL(url).origin;
        const hash = url.split('/').pop().split('?')[0];
        const apiUrl = `${domain}/player/index.php?data=${hash}&do=getVideo`;
        const body = `hash=${hash}&r=${domain}`;
        const jsonText = await req(apiUrl, {
            method: 'POST',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body
        });
        const json = JSON.parse(jsonText);
        if (json && json.videoSource && json.videoSource !== '0') {
            return { name: "ToonStream [AWS]", title: "1080p", type: "url", url: json.videoSource };
        }
    } catch (e) { return null; }
}

async function extractVidStackAPI(url) {
    const res = [];
    try {
        const u = new URL(url);
        // Extract ID: cloudy.upns.one/#ptia8 -> ptia8
        let id = u.hash.replace('#', '') || u.pathname.split('/').pop();
        
        const apiUrl = `${u.origin}/api/source/${id}`;
        
        // V10 FIX: Add 'r' (Referer) to body. Critical for Cloudy/StreamUp.
        const body = new URLSearchParams();
        body.append('r', url); 
        body.append('d', u.hostname);

        const jsonText = await req(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body
        });

        const json = JSON.parse(jsonText);
        if (json && json.data && Array.isArray(json.data)) {
            json.data.forEach(item => {
                if (item.file && (item.file.includes('.m3u8') || item.type === 'hls')) {
                     res.push({ 
                        name: `ToonStream [${u.hostname.replace('www.','').split('.')[0]}]`, // e.g. [cloudy]
                        title: item.label || "Auto", 
                        type: "url", 
                        url: item.file,
                        headers: { "Referer": url }
                    });
                }
            });
        }
    } catch (e) { }
    return res;
}

async function extractUniversal(url) {
    const res = [];
    try {
        const headers = { 'Referer': url, 'Origin': new URL(url).origin };
        const html = await req(url, { headers });
        if (!html) return [];
        
        let content = html;
        let packedCount = 0;
        
        while (packedCount < 5) {
            const packerRegex = /(eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\))/;
            const packed = content.match(packerRegex);
            if (packed) {
                const unpacked = unpack(packed[1]);
                if (unpacked && unpacked !== content) {
                    content = unpacked;
                    packedCount++;
                } else break;
            } else break;
        }

        const urlRegex = /["'](?<url>https?:\\?\/\\?\/[^"']+\.m3u8[^"']*|[^"']+\.m3u8[^"']*)["']/gi;
        const host = new URL(url).hostname.replace('www.', '');
        let m;

        while ((m = urlRegex.exec(content)) !== null) {
            let link = m.groups.url || m[1];
            link = link.replace(/\\/g, '');

            // Relative path fix
            if (!link.startsWith('http')) {
                const u = new URL(url);
                if (link.startsWith('/')) {
                    link = u.origin + link;
                } else {
                    const basePath = url.substring(0, url.lastIndexOf('/') + 1);
                    link = basePath + link;
                }
            }

            if (!res.some(r => r.url === link) && !link.includes('red/pixel')) {
                let name = "ToonStream [HLS]";
                if (host.includes('vidmoly')) name = "ToonStream [VidMoly]";
                else if (host.includes('strmup')) name = "ToonStream [StreamUp]";
                else if (host.includes('cloudy')) name = "ToonStream [Cloudy]";
                else if (host.includes('ruby')) name = "ToonStream [Ruby]";
                else if (host.includes('gdmirror')) name = "ToonStream [GDMirror]";

                res.push({ 
                    name: name, 
                    title: "Auto", 
                    type: "url", 
                    url: link,
                    headers: headers 
                });
            }
        }

    } catch (e) {}
    return res;
}

function unpack(p) {
    try {
        let params = p.match(/\}\('(.*)',\s*(\d+),\s*(\d+),\s*'(.*)'\.split\('\|'\)/);
        if (!params) return null;
        let [_, payload, radix, count, dict] = params;
        dict = dict.split('|');
        return payload.replace(/\b\w+\b/g, (w) => dict[parseInt(w, 36)] || w);
    } catch (e) { return null; }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.ToonStreamProvider = { getStreams }; 
}
