(function () {
  function normalize(value) {
    return (value || "").toLowerCase().trim();
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

  function mountSearch(form) {
    const input = form.querySelector("[data-search-input]");
    const resultBox = form.querySelector("[data-search-results]");
    const count = form.querySelector("[data-search-count]");
    const indexUrl = form.getAttribute("data-index-url");

    if (!input || !resultBox || !indexUrl) return;

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
          const ranked = index
            .map(function (item) {
              return { item: item, score: scoreItem(item, query) };
            })
            .filter(function (entry) {
              return entry.score > 0;
            })
            .sort(function (a, b) {
              return b.score - a.score;
            })
            .slice(0, 8)
            .map(function (entry) {
              return entry.item;
            });

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

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-search-form]").forEach(mountSearch);
  });
})();
