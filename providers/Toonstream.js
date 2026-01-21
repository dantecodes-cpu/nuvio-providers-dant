const TOONSTREAM_BASE = "https://toonstream.one";
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

/**
 * Main entry point - Matches NetMirror's structure
 * Uses TMDB to get the correct title before searching Toonstream
 */
async function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
    try {
        // 1. Get metadata from TMDB (Same as NetMirror)
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const tmdbRes = await fetch(tmdbUrl);
        const tmdbData = await tmdbRes.json();
        
        const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
        if (!title) return [];

        console.log(`[Toonstream] Searching for: ${title}`);

        [span_0](start_span)// 2. Search Toonstream website[span_0](end_span)
        const searchResults = [];
        [span_1](start_span)// Check first 2 pages for better accuracy[span_1](end_span)
        for (let i = 1; i <= 2; i++) {
            const searchUrl = `${TOONSTREAM_BASE}/page/${i}/?s=${encodeURIComponent(title)}`;
            const res = await fetch(searchUrl);
            const html = await res.text();
            const doc = new DOMParser().parseFromString(html, "text/html");
            
            [span_2](start_span)[span_3](start_span)const items = doc.querySelectorAll("#movies-a > ul > li");[span_2](end_span)[span_3](end_span)
            items.forEach(item => {
                [span_4](start_span)const itemTitle = item.querySelector("article h2")?.textContent.replace("Watch Online", "").trim();[span_4](end_span)
                [span_5](start_span)const href = item.querySelector("article > a")?.getAttribute("href");[span_5](end_span)
                if (href) searchResults.push({ title: itemTitle, url: href });
            });
            if (items.length === 0) break;
        }

        // 3. Find the best match
        const match = searchResults.find(r => 
            r.title.toLowerCase().includes(title.toLowerCase())
        ) || searchResults[0];

        if (!match) return [];

        [span_6](start_span)// 4. Load the page to find video links or episodes[span_6](end_span)
        const pageRes = await fetch(match.url);
        const pageHtml = await pageRes.text();
        const pageDoc = new DOMParser().parseFromString(pageHtml, "text/html");

        let targetUrl = match.url;

        [span_7](start_span)// 5. Handle TV Series Episode Selection[span_7](end_span)
        if (mediaType === "tv") {
            [span_8](start_span)const seasonBtn = pageDoc.querySelector(`div.aa-drp.choose-season > ul > li > a`);[span_8](end_span)
            if (seasonBtn) {
                const dataPost = seasonBtn.getAttribute("data-post");
                const dataSeason = seasonNum || 1;

                [span_9](start_span)const ajaxRes = await fetch(`${TOONSTREAM_BASE}/wp-admin/admin-ajax.php`, {[span_9](end_span)
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
                    body: `action=action_select_season&season=${dataSeason}&post=${dataPost}`
                });
                const seasonHtml = await ajaxRes.text();
                const seasonDoc = new DOMParser().parseFromString(seasonHtml, "text/html");
                
                [span_10](start_span)// Find specific episode[span_10](end_span)
                const episodes = seasonDoc.querySelectorAll("article");
                const targetEp = episodes[episodeNum - 1] || episodes[0];
                targetUrl = targetEp?.querySelector("a")?.getAttribute("href") || targetUrl;
            }
        }

        [span_11](start_span)// 6. Extract Final Streaming Links[span_11](end_span)
        return await extractLinks(targetUrl, title);

    } catch (e) {
        console.error("[Toonstream] Error:", e);
        return [];
    }
}

/**
 * [span_12](start_span)Extracts links from iframes found on the page[span_12](end_span)
 */
async function extractLinks(url, title) {
    const res = await fetch(url);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const streams = [];

    [span_13](start_span)const iframes = doc.querySelectorAll("#aa-options > div > iframe");[span_13](end_span)
    for (const iframe of iframes) {
        const serverUrl = iframe.getAttribute("data-src");
        if (!serverUrl) continue;

        [span_14](start_span)// Handle Zephyrflick / AWStream[span_14](end_span)
        if (serverUrl.includes("zephyrflick") || serverUrl.includes("awstream")) {
            const hash = serverUrl.split("/").pop();
            const apiBase = serverUrl.includes("zephyrflick") ? "https://play.zephyrflick.top" : "https://z.awstream.net";
            
            [span_15](start_span)const apiRes = await fetch(`${apiBase}/player/index.php?data=${hash}&do=getVideo`, {[span_15](end_span)
                method: "POST",
                headers: { "x-requested-with": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded" },
                body: `hash=${hash}&r=${encodeURIComponent(TOONSTREAM_BASE)}`
            });

            const json = await apiRes.json();
            [span_16](start_span)if (json.videoSource) {[span_16](end_span)
                streams.push({
                    name: "Toonstream (HLS)",
                    title: `${title} - 1080p`,
                    url: json.videoSource,
                    [span_17](start_span)quality: "1080p",[span_17](end_span)
                    type: "hls"
                });
            }
        }
    }
    return streams;
}
