(function () {
  const GLOBAL_SEARCH_PLACEHOLDER = "Search MCP-AQL docs, spec pages, and adapter patterns...";

  function normalize(value) {
    return (value || "").toLowerCase().trim();
  }

  function rankItems(index, query, limit) {
    return index
      .map(function (item) {
        return { item: item, score: scoreItem(item, query) };
      })
      .filter(function (entry) {
        return entry.score > 0;
      })
      .sort(function (a, b) {
        return b.score - a.score;
      })
      .slice(0, typeof limit === "number" ? limit : index.length)
      .map(function (entry) {
        return entry.item;
      });
  }

  function escapeHtml(value) {
    return (value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function buildSearchPageUrl(indexUrl, query) {
    const target = (indexUrl || "data/search-index.json").replace(/data\/search-index\.json$/, "search.html");
    return target + "?q=" + encodeURIComponent(query || "");
  }

  function scoreItem(item, query) {
    const q = normalize(query);
    if (!q) return 0;

    const title = normalize(item.title);
    const excerpt = normalize(item.excerpt);
    const keywords = normalize((item.keywords || []).join(" "));
    const url = normalize(item.url);

    let score = 0;
    if (title.includes(q)) score += 8;
    if (excerpt.includes(q)) score += 4;
    if (keywords.includes(q)) score += 5;
    if (url.includes(q)) score += 2;

    return score;
  }

  function renderResultItem(item) {
    const li = document.createElement("li");
    li.className = "search-result-item";

    const link = document.createElement("a");
    link.href = item.url;

    const title = document.createElement("strong");
    title.textContent = item.title;

    const excerpt = document.createElement("span");
    excerpt.textContent = item.excerpt;

    link.appendChild(title);
    link.appendChild(excerpt);

    li.appendChild(link);
    return li;
  }

  function renderPageResultItem(item, query) {
    const li = document.createElement("li");
    li.className = "search-page-item card";

    const title = document.createElement("h3");
    const link = document.createElement("a");
    link.href = item.url;
    link.textContent = item.title;
    title.appendChild(link);

    const excerpt = document.createElement("p");
    excerpt.textContent = item.excerpt;

    const meta = document.createElement("p");
    meta.className = "search-page-meta";
    meta.innerHTML = "Match for <code>" + escapeHtml(query) + "</code> in " + escapeHtml(item.url);

    li.appendChild(title);
    li.appendChild(excerpt);
    li.appendChild(meta);
    return li;
  }

  function mountSearch(form) {
    const input = form.querySelector("[data-search-input]");
    const resultBox = form.querySelector("[data-search-results]");
    const count = form.querySelector("[data-search-count]");
    const indexUrl = form.getAttribute("data-index-url");

    if (!input || !resultBox || !indexUrl) return;

    input.placeholder = GLOBAL_SEARCH_PLACEHOLDER;
    input.setAttribute("enterkeyhint", "search");

    let indexPromise;

    function closeResults() {
      resultBox.hidden = true;
      resultBox.innerHTML = "";
      if (count) count.textContent = "";
    }

    function loadIndex() {
      if (!indexPromise) {
        indexPromise = fetch(indexUrl)
          .then(function (resp) {
            if (!resp.ok) throw new Error("Search index fetch failed");
            return resp.json();
          });
      }

      return indexPromise;
    }

    function updateResults() {
      const query = input.value.trim();
      if (!query) {
        closeResults();
        return;
      }

      loadIndex()
        .then(function (index) {
          const ranked = rankItems(index, query, 8);

          resultBox.innerHTML = "";

          if (!ranked.length) {
            const empty = document.createElement("li");
            empty.className = "search-result-empty";
            empty.textContent = "No matches yet. Try protocol terms like introspect, conformance, gatekeeper, or adapter.";
            resultBox.appendChild(empty);
            resultBox.hidden = false;
            if (count) count.textContent = "0 results";
            return;
          }

          ranked.forEach(function (item) {
            resultBox.appendChild(renderResultItem(item));
          });

          resultBox.hidden = false;
          if (count) count.textContent = ranked.length + " result" + (ranked.length === 1 ? "" : "s");
        })
        .catch(function () {
          if (count) count.textContent = "Search unavailable";
        });
    }

    input.addEventListener("input", updateResults);
    input.addEventListener("focus", function () {
      loadIndex().catch(function () {
        if (count) count.textContent = "Search unavailable";
      });
    }, { once: true });
    input.addEventListener("focus", updateResults);
    form.addEventListener("submit", function (event) {
      const query = input.value.trim();
      if (!query) {
        event.preventDefault();
        closeResults();
        return;
      }

      event.preventDefault();
      window.location.href = buildSearchPageUrl(indexUrl, query);
    });

    document.addEventListener("click", function (event) {
      if (!form.contains(event.target)) {
        closeResults();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeResults();
        input.blur();
      }
    });
  }

  function mountSearchPage() {
    const page = document.querySelector("[data-search-page]");
    if (!page) return;

    const params = new URLSearchParams(window.location.search);
    const query = (params.get("q") || "").trim();
    const indexUrl = page.getAttribute("data-index-url") || "data/search-index.json";
    const queryLabel = page.querySelector("[data-search-query]");
    const count = page.querySelector("[data-search-page-count]");
    const resultsList = page.querySelector("[data-search-page-results]");
    const empty = page.querySelector("[data-search-page-empty]");
    const formInput = document.querySelector("[data-search-input]");

    if (formInput) {
      formInput.value = query;
      formInput.placeholder = GLOBAL_SEARCH_PLACEHOLDER;
    }

    if (queryLabel) {
      queryLabel.textContent = query || "all docs";
    }

    if (!query) {
      if (count) count.textContent = "Enter a protocol term to search the documentation.";
      if (empty) empty.hidden = false;
      if (resultsList) resultsList.innerHTML = "";
      return;
    }

    fetch(indexUrl)
      .then(function (resp) {
        if (!resp.ok) throw new Error("Search index fetch failed");
        return resp.json();
      })
      .then(function (index) {
        const ranked = rankItems(index, query);

        if (count) {
          count.textContent = ranked.length + " result" + (ranked.length === 1 ? "" : "s") + " for \"" + query + "\"";
        }

        if (!resultsList) return;
        resultsList.innerHTML = "";

        if (!ranked.length) {
          if (empty) empty.hidden = false;
          return;
        }

        if (empty) empty.hidden = true;
        ranked.forEach(function (item) {
          resultsList.appendChild(renderPageResultItem(item, query));
        });
      })
      .catch(function () {
        if (count) count.textContent = "Search unavailable right now.";
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-search-form]").forEach(mountSearch);
    mountSearchPage();
  });
})();
