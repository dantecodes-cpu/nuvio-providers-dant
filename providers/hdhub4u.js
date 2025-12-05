// HDHub4u Scraper for Nuvio (Merged: Kotlin-faithful + defensive fixes)
// Version: 3.0.1 (Hardened)
// Promise-based only (no async/await) - compatible with Nuvio local scrapers

const cheerio = require('cheerio-without-node-native');

// =================================================================================
// CONFIG
// =================================================================================

const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
let MAIN_URL = "https://hdhub4u.frl";
const DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";

const DOMAIN_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours
let lastDomainUpdate = 0;

const DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    "Cookie": "xla=s4t",
    "Referer": `${MAIN_URL}/`,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
};

// Helper to clone headers and set referer if needed
function buildHeaders(overrides) {
    const h = Object.assign({}, DEFAULT_HEADERS);
    if (overrides) Object.keys(overrides).forEach(k => { h[k] = overrides[k]; });
    return h;
}

// =================================================================================
// POLYFILLS / UTILITIES
// =================================================================================

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

// Safe atob (Base64 decode) - a bit more defensive than the very strict one
function atobSafe(input) {
    if (!input) return '';
    try {
        let str = String(input).replace(/=+$/, '');
        if (str.length % 4 === 1) throw new Error('Invalid base64 string');
        let output = '';
        let bc = 0, bs, buffer, idx = 0;
        while ((buffer = str.charAt(idx++))) {
            buffer = BASE64_CHARS.indexOf(buffer);
            if (buffer === -1) continue;
            bs = bc % 4 ? bs * 64 + buffer : buffer;
            if (bc++ % 4) {
                output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
            }
        }
        return output;
    } catch (e) {
        // Fallback to built-in if available (some environments)
        try { return (typeof global !== 'undefined' && global.atob) ? global.atob(input) : ''; } catch (e2) { return ''; }
    }
}

// Safe btoa (Base64 encode)
function btoaSafe(input) {
    if (input == null) return '';
    try {
        let str = String(input);
        let output = '';
        let i = 0;
        while (i < str.length) {
            const chr1 = str.charCodeAt(i++);
            const chr2 = str.charCodeAt(i++);
            const chr3 = str.charCodeAt(i++);
            const enc1 = chr1 >> 2;
            const enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
            let enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
            let enc4 = chr3 & 63;
            if (isNaN(chr2)) {
                enc3 = 64;
                enc4 = 64;
            } else if (isNaN(chr3)) {
                enc4 = 64;
            }
            output += BASE64_CHARS.charAt(enc1) + BASE64_CHARS.charAt(enc2) +
                      BASE64_CHARS.charAt(enc3) + BASE64_CHARS.charAt(enc4);
        }
        return output;
    } catch (e) {
        try { return (typeof global !== 'undefined' && global.btoa) ? global.btoa(input) : ''; } catch (e2) { return ''; }
    }
}

// ROT13 (pen)
function rot13(str) {
    if (!str) return '';
    return str.replace(/[a-zA-Z]/g, function(c) {
        return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
    });
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return 'Unknown';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function cleanTitle(raw) {
    if (!raw) return "";
    let name = raw.split('(')[0].trim();
    name = name.replace(/\s+/g, " ");
    return name.toLowerCase();
}

function getQualityFromString(str) {
    if (!str) return 'Unknown';
    const m4k = str.match(/4\s?k/i);
    if (m4k) return '4K';
    const match = str.match(/(\d{3,4})[pP]/);
    if (match) return match[1] + 'p';
    return 'Unknown';
}

function getQualityScore(qualityStr) {
    const map = { '4K': 5, '2160p': 5, '1080p': 4, '720p': 3, '480p': 2, '360p': 1 };
    return map[qualityStr] || 0;
}

// =================================================================================
// NETWORK HELPERS (timeouts and concurrency)
// =================================================================================

function fetchWithTimeout(url, options, timeoutMs) {
    timeoutMs = timeoutMs || 9000;
    try {
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        if (controller) {
            const tid = setTimeout(function() { try { controller.abort(); } catch (e) {} }, timeoutMs);
            const opts = Object.assign({}, options || {});
            opts.signal = controller.signal;
            return fetch(url, opts).then(function(res) {
                clearTimeout(tid);
                return res;
            }).catch(function(err) {
                clearTimeout(tid);
                throw err;
            });
        } else {
            // No AbortController - just call fetch (best effort)
            return fetch(url, options);
        }
    } catch (e) {
        return new Promise(function(resolve, reject) { reject(e); });
    }
}

// Simple promise pool (limit concurrency)
function promisePool(tasks, concurrency) {
    concurrency = concurrency || 5;
    let i = 0;
    const results = [];
    const total = tasks.length;
    return new Promise(function(resolve) {
        if (total === 0) return resolve(results);
        let active = 0;
        function next() {
            if (i >= total && active === 0) return resolve(results);
            while (active < concurrency && i < total) {
                const idx = i++;
                active++;
                Promise.resolve().then(function() {
                    return tasks[idx]();
                }).then(function(res) {
                    results[idx] = res;
                }).catch(function() {
                    results[idx] = [];
                }).finally(function() {
                    active--;
                    next();
                });
            }
        }
        next();
    });
}

// =================================================================================
// DOMAIN UPDATE (uses DOMAIN_CACHE_TTL)
// =================================================================================

function updateDomain() {
    const now = Date.now();
    if (now - lastDomainUpdate < DOMAIN_CACHE_TTL) return Promise.resolve();
    // Use fetchWithTimeout to avoid hangs
    return fetchWithTimeout(DOMAINS_URL, { method: 'GET', headers: buildHeaders() }, 9000)
        .then(function(r) {
            if (!r.ok) throw new Error('Domain list fetch failed: ' + r.status);
            return r.json();
        })
        .then(function(data) {
            lastDomainUpdate = now; // set timestamp even on success
            if (data && data.HDHUB4u) {
                const newDomain = data.HDHUB4u;
                if (newDomain && newDomain !== MAIN_URL) {
                    MAIN_URL = newDomain;
                }
                // update default referer header value
                DEFAULT_HEADERS.Referer = `${MAIN_URL}/`;
            }
            return;
        }).catch(function(err) {
            // set timestamp to avoid hammering domain endpoint
            lastDomainUpdate = now;
            return;
        });
}

// =================================================================================
// REDIRECT / DE-OBFUSCATION
// =================================================================================

/**
 * getRedirectLinks(url)
 * Attempts to decode obfuscated redirect pages.
 * This function preserves the Kotlin decoding chain but is defensive:
 * - uses fallbacks
 * - does not throw on decode problems
 * - returns original URL when it can't resolve
 */
function getRedirectLinks(url) {
    return fetchWithTimeout(url, { headers: buildHeaders() }, 9000)
        .then(function(res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.text();
        })
        .then(function(html) {
            // find s('o','...') or ck('_wp_http_x','...')
            const regex = /s\(['"]o['"],\s*['"]([A-Za-z0-9+/=]+)['"]\)|ck\(['"]_wp_http_\d+['"],\s*['"]([^'"]+)['"]\)/g;
            let combinedString = '';
            var match;
            while ((match = regex.exec(html)) !== null) {
                combinedString += match[1] || match[2] || '';
            }

            if (!combinedString) {
                // fallback: look for large base64-like substrings in the page
                const fallback = html.match(/['"]([A-Za-z0-9+/=]{40,})['"]/);
                if (fallback) combinedString = fallback[1];
            }

            if (!combinedString) return url;

            // Defensive decoding chain: attempt the expected chain, but fall back gracefully
            try {
                let step1 = atobSafe(combinedString) || '';
                let step2 = atobSafe(step1) || '';
                let step3 = rot13(step2) || '';
                let step4 = atobSafe(step3) || '';

                // Try parse step4 as JSON
                try {
                    var parsed = JSON.parse(step4);
                } catch (e) {
                    // maybe step4 is already a URL
                    if (step4.indexOf('http') === 0) return step4;
                    parsed = null;
                }

                if (parsed) {
                    if (parsed.o) {
                        const decodedO = atobSafe(parsed.o).trim();
                        if (decodedO) return decodedO;
                    }

                    if (parsed.blog_url && parsed.data) {
                        // Some Kotlin logic: btoa(json.data) and fetch blog_url?re=data
                        const dataParam = btoaSafe(parsed.data).trim();
                        if (parsed.blog_url && dataParam) {
                            return fetchWithTimeout(parsed.blog_url + '?re=' + dataParam, { headers: buildHeaders() }, 9000)
                                .then(function(r2) {
                                    if (!r2.ok) return url;
                                    return r2.text().then(function(t) {
                                        // Kotlin took body text; we do the same
                                        const $ = cheerio.load(t || '');
                                        const bodyText = $('body').text().trim();
                                        return bodyText || url;
                                    }).catch(function() { return url; });
                                }).catch(function() { return url; });
                        }
                    }
                }

                // If parsing didn't produce final link, return original (fallback)
                return url;
            } catch (e) {
                return url;
            }
        }).catch(function() {
            return url; // Always fallback to original url on errors
        });
}

// =================================================================================
// EXTRACTORS (HubCloud, HubCDN, Pixeldrain, Direct)
// =================================================================================

function extractHubCloud(url, referer, quality) {
    // Accept both hubcloud.ink and hubcloud.dad by default; use hubcloud.dad as fallback
    let targetUrl = url;
    try { targetUrl = url.replace("hubcloud.ink", "hubcloud.dad"); } catch (e) {}
    const headersForFirst = buildHeaders({ Referer: referer });

    return fetchWithTimeout(targetUrl, { headers: headersForFirst }, 9000)
        .then(function(res) {
            if (!res.ok) throw new Error('HubCloud fetch failed');
            return res.text().then(function(html) {
                // Check for JS redirect var url = '...'
                const jsRedirect = html.match(/var\s+url\s*=\s*'([^']+)'/);
                if (!targetUrl.includes("hubcloud.php") && jsRedirect && jsRedirect[1]) {
                    const finalUrl = jsRedirect[1];
                    return fetchWithTimeout(finalUrl, { headers: buildHeaders({ Referer: targetUrl }) }, 9000)
                        .then(function(r2) {
                            if (!r2.ok) throw new Error('HubCloud second fetch failed');
                            return r2.text().then(function(secondHtml) {
                                return { html: secondHtml, url: finalUrl };
                            });
                        }).catch(function() {
                            // fallback to original html
                            return { html: html, url: targetUrl };
                        });
                }
                return { html: html, url: targetUrl };
            });
        }).then(function(result) {
            try {
                const $ = cheerio.load(result.html || '');
                let finalHtml = result.html || '';
                const currentUrl = result.url || targetUrl;

                const downloadHref = $('#download').attr('href');
                // If there's a download button, follow it to get the list
                const prePromise = downloadHref ? (function() {
                    let nextUrl = downloadHref;
                    if (!/^https?:\/\//i.test(nextUrl)) {
                        try { nextUrl = new URL(downloadHref, currentUrl).toString(); } catch (e) {}
                    }
                    return fetchWithTimeout(nextUrl, { headers: buildHeaders() }, 9000)
                        .then(function(r) {
                            if (!r.ok) return '';
                            return r.text().then(function(newHtml) {
                                return { html: newHtml, url: nextUrl };
                            }).catch(function() { return { html: finalHtml, url: currentUrl }; });
                        }).catch(function() { return { html: finalHtml, url: currentUrl }; });
                })() : Promise.resolve({ html: finalHtml, url: currentUrl });

                return prePromise.then(function(updated) {
                    const htmlToParse = (updated && updated.html) ? updated.html : finalHtml;
                    const pageUrl = (updated && updated.url) ? updated.url : currentUrl;
                    const $$ = cheerio.load(htmlToParse);

                    const size = $$('i#size').text().trim() || '';
                    const title = $$('div.card-header').text().trim() || '';
                    const elements = $$('div.card-body h2 a.btn').toArray();

                    const links = [];
                    const elementTasks = elements.map(function(el) {
                        return function() {
                            try {
                                const linkUrl = $$(el).attr('href');
                                const btnText = ($$(el).text() || '').trim();
                                const serverLabel = "HDHub4u " + (btnText || "HubCloud");

                                const baseObj = {
                                    title: title || "Unknown",
                                    quality: quality || "Unknown",
                                    size: size || "Unknown",
                                    headers: buildHeaders(),
                                    provider: 'hdhub4u'
                                };

                                if (!linkUrl) return Promise.resolve();

                                // Direct download / standard servers
                                if (btnText.includes("Download File") ||
                                    btnText.includes("FSL Server") ||
                                    btnText.includes("S3 Server") ||
                                    btnText.includes("Mega Server") ||
                                    btnText.includes("FSLv2")) {
                                    links.push(Object.assign({}, baseObj, { name: serverLabel, url: linkUrl }));
                                    return Promise.resolve();
                                }

                                // BuzzServer - check redirect
                                if (btnText.includes("BuzzServer")) {
                                    return fetchWithTimeout(linkUrl + '/download', { method: 'GET', headers: buildHeaders({ Referer: linkUrl }) }, 9000)
                                        .then(function(resBuzz) {
                                            // manual redirect header might be `location` or `hx-redirect`
                                            const hx = (resBuzz.headers && (resBuzz.headers.get && resBuzz.headers.get('hx-redirect'))) || (resBuzz.headers && (resBuzz.headers.get && resBuzz.headers.get('location')));
                                            if (hx) links.push(Object.assign({}, baseObj, { name: serverLabel, url: hx }));
                                        }).catch(function() {});
                                }

                                // PixelDrain special case
                                if (/pixeldrain/i.test(linkUrl)) {
                                    const fileId = linkUrl.split('/').pop();
                                    const dl = `https://pixeldrain.com/api/file/${fileId}?download`;
                                    links.push(Object.assign({}, baseObj, { name: "HDHub4u PixelDrain", url: dl }));
                                    return Promise.resolve();
                                }

                                // 10Gbps redirect loop
                                if (btnText.includes("10Gbps")) {
                                    // follow up to 5 redirects manually
                                    const follow = function(u, cnt) {
                                        if (!u || cnt > 5) return Promise.resolve(null);
                                        return fetchWithTimeout(u, { method: 'GET', redirect: 'manual', headers: buildHeaders() }, 9000)
                                            .then(function(rf) {
                                                const loc = rf.headers && (rf.headers.get && rf.headers.get('location'));
                                                if (!loc) return null;
                                                if (loc.indexOf('link=') !== -1) {
                                                    return decodeURIComponent(loc.split('link=')[1]);
                                                }
                                                // Resolve relative and continue
                                                try {
                                                    const resolved = new URL(loc, u).toString();
                                                    return follow(resolved, cnt + 1);
                                                } catch (e) {
                                                    return null;
                                                }
                                            }).catch(function() { return null; });
                                    };
                                    return follow(linkUrl, 0).then(function(final) {
                                        if (final) links.push(Object.assign({}, baseObj, { name: serverLabel, url: final }));
                                    });
                                }

                                // Unknown button -> ignore (could call generic extractor here)
                                return Promise.resolve();
                            } catch (err) { return Promise.resolve(); }
                        };
                    });

                    // Run element tasks with limited concurrency
                    return promisePool(elementTasks, 5).then(function() {
                        return links;
                    });
                });
            } catch (err) {
                return [];
            }
        }).catch(function(err) {
            return [];
        });
}

function extractHubCdn(url) {
    return fetchWithTimeout(url, { headers: buildHeaders() }, 9000)
        .then(function(r) {
            if (!r.ok) throw new Error('HubCDN fetch failed');
            return r.text().then(function(html) {
                const m = html.match(/r=([A-Za-z0-9+/=]+)/);
                if (m && m[1]) {
                    const dec = atobSafe(m[1]);
                    const finalLink = (dec && dec.split('link=')[1]) ? dec.split('link=')[1] : null;
                    if (finalLink) {
                        return [{
                            name: "HDHub4u HubCDN",
                            url: finalLink,
                            quality: "Unknown",
                            provider: "hdhub4u",
                            headers: buildHeaders()
                        }];
                    }
                }
                return [];
            });
        }).catch(function() { return []; });
}

function extractPixeldrain(url, quality) {
    try {
        const fileId = url.split('/').pop();
        const dl = `https://pixeldrain.com/api/file/${fileId}?download`;
        return Promise.resolve([{
            name: "HDHub4u PixelDrain",
            url: dl,
            quality: quality || "Unknown",
            provider: "hdhub4u",
            headers: buildHeaders()
        }]);
    } catch (e) {
        return Promise.resolve([]);
    }
}

function extractDirectFile(url, quality) {
    return Promise.resolve([{
        name: "HDHub4u Direct",
        url: url,
        quality: quality || "Unknown",
        provider: "hdhub4u",
        headers: buildHeaders()
    }]);
}

// Dispatcher for hosters
function resolveExtractor(url, referer, quality) {
    const u = (url || '').toLowerCase();
    if (u.indexOf('hubcloud') !== -1 || u.indexOf('hubdrive') !== -1) return extractHubCloud(url, referer, quality);
    if (u.indexOf('hubcdn') !== -1) return extractHubCdn(url);
    if (u.indexOf('pixeldrain') !== -1) return extractPixeldrain(url, quality);
    if (/\.(mp4|mkv|webm)$/i.test(u)) return extractDirectFile(url, quality);
    // Not supported host -> return empty
    return Promise.resolve([]);
}

// =================================================================================
// SEARCH + MAIN LOGIC (preserving Kotlin flow)
// =================================================================================

function search(query) {
    return updateDomain().then(function() {
        const url = `${MAIN_URL}/?s=${encodeURIComponent(query)}`;
        return fetchWithTimeout(url, { headers: buildHeaders() }, 9000)
            .then(function(r) {
                if (!r.ok) return [];
                return r.text().then(function(html) {
                    const $ = cheerio.load(html || '');
                    const results = [];
                    $('.recent-movies > li.thumb').each(function(i, el) {
                        try {
                            const title = $(el).find('figcaption p').first().text().trim();
                            const link = $(el).find('figure a').attr('href');
                            results.push({ title: title || '', link: link || '' });
                        } catch (e) {}
                    });
                    return results;
                });
            }).catch(function() { return []; });
    });
}

/**
 * getStreams(tmdbId, mediaType, season, episode)
 * Returns a Promise that resolves to an array of stream objects.
 * Uses Promise-only style (no async/await).
 */
function getStreams(tmdbId, mediaType, season, episode) {
    // Defensive parameter handling
    mediaType = mediaType || 'movie';
    season = season || null;
    episode = (typeof episode !== 'undefined') ? episode : null;

    const typePath = (mediaType === 'tv') ? 'tv' : 'movie';
    const tmdbUrl = `${TMDB_BASE_URL}/${typePath}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;

    return fetchWithTimeout(tmdbUrl, { headers: buildHeaders() }, 9000)
        .then(function(r) {
            if (!r.ok) throw new Error('TMDB fetch failed: ' + r.status);
            return r.json();
        }).then(function(meta) {
            const title = (mediaType === 'tv') ? (meta && meta.name) : (meta && meta.title);
            const releaseDate = (mediaType === 'tv') ? meta && meta.first_air_date : meta && meta.release_date;
            const year = releaseDate ? (releaseDate.split('-')[0] || '') : '';
            if (!title) throw new Error('No title from TMDB');

            const cleanedTitle = cleanTitle(title);
            let query = title;
            if (mediaType === 'tv' && season) query += ' Season ' + season;

            return search(query).then(function(results) {
                if (!results || results.length === 0) return [];

                // Find best match by cleanTitle substring, else take first
                var target = null;
                for (var i = 0; i < results.length; i++) {
                    try {
                        if (cleanTitle(results[i].title).indexOf(cleanedTitle) !== -1) {
                            target = results[i];
                            break;
                        }
                    } catch (e) {}
                }
                if (!target) target = results[0];

                if (!target || !target.link) return [];

                // Fetch the target page
                return fetchWithTimeout(target.link, { headers: buildHeaders() }, 9000)
                    .then(function(r2) {
                        if (!r2.ok) return [];
                        return r2.text().then(function(html) {
                            const $ = cheerio.load(html || '');
                            const linksToProcess = [];

                            if (mediaType === 'movie') {
                                $('h3 a, h4 a').each(function(i, el) {
                                    try {
                                        const txt = $(el).text();
                                        const href = $(el).attr('href');
                                        if (txt && href && txt.match(/480|720|1080|2160|4K/i)) {
                                            linksToProcess.push({ url: href, quality: getQualityFromString(txt) });
                                        }
                                    } catch (e) {}
                                });
                            } else {
                                // TV flow: identify two paths (quality redirect blocks OR episode headers)
                                $('h3, h4').each(function(i, el) {
                                    try {
                                        const headerText = $(el).text() || '';
                                        const hasQualityLinks = $(el).find('a').toArray().some(function(a) {
                                            try { return ($(a).text() || '').match(/1080|720|4K|2160/i); } catch (e) { return false; }
                                        });

                                        // Episode match
                                        const epMatch = headerText.match(/(?:Episode|E)\s*(\d+)/i);
                                        const epNumHeader = epMatch ? parseInt(epMatch[1]) : null;

                                        if (hasQualityLinks) {
                                            $(el).find('a').each(function(j, a) {
                                                const linkHref = $(a).attr('href');
                                                if (linkHref) {
                                                    linksToProcess.push({ url: linkHref, isRedirectBlock: true, targetEpisode: episode });
                                                }
                                            });
                                        } else if (epNumHeader && episode !== null && epNumHeader === episode) {
                                            // collect direct links from header
                                            $(el).find('a').each(function(j, a) {
                                                const linkHref = $(a).attr('href');
                                                if (linkHref) linksToProcess.push({ url: linkHref, quality: "Unknown" });
                                            });
                                            // gather sibling links until hr or next header
                                            let next = $(el).next();
                                            while (next && next.length && !next.is('hr') && !next.is('h3') && !next.is('h4')) {
                                                next.find('a').each(function(k, a) {
                                                    const href = $(a).attr('href');
                                                    if (href) linksToProcess.push({ url: href, quality: "Unknown" });
                                                });
                                                next = next.next();
                                            }
                                        }
                                    } catch (e) {}
                                });
                            }

                            // For each link in linksToProcess, create a task returning a Promise
                            const tasks = linksToProcess.map(function(linkObj) {
                                return function() {
                                    const url = linkObj.url;
                                    const quality = linkObj.quality || "Unknown";
                                    const isRedirectBlock = !!linkObj.isRedirectBlock;
                                    const targetEpisode = linkObj.targetEpisode;

                                    if (isRedirectBlock) {
                                        // Resolve redirect -> fetch the list page -> find episode links -> resolve each
                                        return getRedirectLinks(url).then(function(resolved) {
                                            if (!resolved) return [];
                                            return fetchWithTimeout(resolved, { headers: buildHeaders() }, 9000)
                                                .then(function(r3) {
                                                    if (!r3.ok) return [];
                                                    return r3.text().then(function(subHtml) {
                                                        const $$ = cheerio.load(subHtml || '');
                                                        const subLinks = [];
                                                        $$('h5 a').each(function(i, el) {
                                                            try {
                                                                const t = $$(el).text() || '';
                                                                const match = t.match(/(?:Episode|E)\s*(\d+)/i);
                                                                if (match && parseInt(match[1]) === targetEpisode) {
                                                                    const href = $$(el).attr('href');
                                                                    if (href) subLinks.push({ url: href, quality: getQualityFromString(t) || "Unknown" });
                                                                }
                                                            } catch (e) {}
                                                        });

                                                        // For each sublink, resolve redirect and then run resolveExtractor
                                                        const subTasks = subLinks.map(function(sl) {
                                                            return function() {
                                                                return getRedirectLinks(sl.url).then(function(finalUrl) {
                                                                    if (!finalUrl) return [];
                                                                    return resolveExtractor(finalUrl, resolved, sl.quality);
                                                                }).catch(function() { return []; });
                                                            };
                                                        });

                                                        // run subTasks with limited concurrency
                                                        return promisePool(subTasks, 4).then(function(subResults) {
                                                            return subResults.flat();
                                                        });
                                                    }).catch(function() { return []; });
                                                }).catch(function() { return []; });
                                        }).catch(function() { return []; });
                                    } else {
                                        // Direct link: resolve redirect then pass to host extractor
                                        return getRedirectLinks(url).then(function(finalUrl) {
                                            if (!finalUrl) return [];
                                            return resolveExtractor(finalUrl, target.link || MAIN_URL, quality).then(function(resolvedStreams) {
                                                return resolvedStreams || [];
                                            }).catch(function() { return []; });
                                        }).catch(function() { return []; });
                                    }
                                };
                            });

                            // Execute tasks with concurrency limit
                            return promisePool(tasks, 5).then(function(results) {
                                const flattened = results.flat();
                                // Filter and deduplicate
                                const unique = [];
                                const seen = new Set();
                                for (var i = 0; i < flattened.length; i++) {
                                    const s = flattened[i];
                                    if (!s || !s.url) continue;
                                    if (s.url && seen.has(s.url)) continue;
                                    seen.add(s.url);
                                    // Normalize fields
                                    s.quality = s.quality || "Unknown";
                                    s.size = s.size || "Unknown";
                                    s.headers = s.headers || buildHeaders();
                                    s.provider = s.provider || 'hdhub4u';
                                    unique.push(s);
                                }
                                // sort by quality score descending
                                unique.sort(function(a,b) { return getQualityScore(b.quality) - getQualityScore(a.quality); });
                                return unique;
                            });
                        }).catch(function() { return []; });
                    }).catch(function() { return []; });
            }).catch(function() { return []; });
        }).catch(function(err) {
            return [];
        });
}

// Export for Nuvio
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
