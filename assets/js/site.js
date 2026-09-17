(function () {
  function initMasthead() {
    var masthead = document.querySelector(".masthead");
    if (!masthead) return;

    function update() {
      masthead.classList.toggle("is-scrolled", window.scrollY > 12);
    }

    function updateClearance() {
      document.documentElement.style.setProperty("--bottom-nav-height", Math.ceil(masthead.getBoundingClientRect().height) + "px");
    }

    update();
    updateClearance();
    if (window.ResizeObserver) {
      new ResizeObserver(updateClearance).observe(masthead);
    } else {
      window.addEventListener("resize", updateClearance, { passive: true });
    }
    window.addEventListener("scroll", update, { passive: true });
  }

  function initMastheadGlassIndicator() {
    var nav = document.querySelector(".greedy-nav");
    if (!nav) return;

    var indicator = nav.querySelector(".masthead-glass-indicator");
    var links = Array.prototype.slice.call(nav.querySelectorAll(".visible-links a"));
    if (!indicator || !links.length) return;

    var activeLink = null;
    var currentLink = getCurrentLink();
    var hideTimer = 0;
    var transitionKey = "masthead-indicator-transition";
    var pendingDestination = null;

    if (currentLink) currentLink.setAttribute("aria-current", "page");

    function setIndicatorBox(box) {
      nav.style.setProperty("--indicator-x", box.x.toFixed(2) + "px");
      nav.style.setProperty("--indicator-y", box.y.toFixed(2) + "px");
      nav.style.setProperty("--indicator-width", box.width.toFixed(2) + "px");
      nav.style.setProperty("--indicator-height", box.height.toFixed(2) + "px");
    }

    function saveDeparture() {
      if (!pendingDestination || !activeLink) return;
      var navRect = nav.getBoundingClientRect();
      var rect = indicator.getBoundingClientRect();
      try {
        window.sessionStorage.setItem(transitionKey, JSON.stringify({
          destination: pendingDestination, savedAt: Date.now(),
          viewportWidth: window.innerWidth, navWidth: navRect.width, navHeight: navRect.height,
          x: rect.left - navRect.left, y: rect.top - navRect.top,
          width: rect.width, height: rect.height
        }));
      } catch (error) {
        // Storage may be disabled; direct placement remains available.
      }
    }

    function readDeparture() {
      try {
        var saved = window.sessionStorage.getItem(transitionKey);
        window.sessionStorage.removeItem(transitionKey);
        if (!saved || !currentLink) return null;
        var box = JSON.parse(saved);
        var rect = nav.getBoundingClientRect();
        var navigation = window.performance.getEntriesByType("navigation")[0];
        if (navigation && navigation.type !== "navigate") return null;
        if (box.destination !== window.location.href || Date.now() - box.savedAt > 15000) return null;
        if (![box.x, box.y, box.width, box.height, box.savedAt].every(Number.isFinite)) return null;
        if (box.viewportWidth !== window.innerWidth || Math.abs(box.navWidth - rect.width) > 2 || Math.abs(box.navHeight - rect.height) > 2) return null;
        if (box.width <= 0 || box.height <= 0 || box.x < -4 || box.y < -4 || box.x + box.width > rect.width + 4 || box.y + box.height > rect.height + 4) return null;
        return box;
      } catch (error) {
        return null;
      }
    }

    function placeInitialIndicator(box) {
      nav.classList.add("is-indicator-positioning");
      if (box) {
        setIndicatorBox(box);
        nav.classList.add("is-indicator-active");
      } else {
        moveToCurrent();
      }
      // Commit the previous page's visible box (or the current button on a fresh visit).
      void indicator.offsetWidth;
      nav.classList.remove("is-indicator-positioning");
      if (box) moveToCurrent();
    }

    function normalizePath(path) {
      if (!path || path === "/") return "/";
      return path.replace(/\/+$/, "");
    }

    function getCurrentLink() {
      var currentPath = normalizePath(window.location.pathname);

      return links.find(function (link) {
        var linkUrl;
        try {
          linkUrl = new URL(link.getAttribute("href"), window.location.href);
        } catch (error) {
          return false;
        }

        return linkUrl.origin === window.location.origin && normalizePath(linkUrl.pathname) === currentPath;
      }) || null;
    }

    function setPointer(event, link) {
      var rect = link.getBoundingClientRect();
      var x = ((event.clientX - rect.left) / rect.width) * 100;
      var y = ((event.clientY - rect.top) / rect.height) * 100;

      nav.style.setProperty("--indicator-pointer-x", Math.max(0, Math.min(100, x)).toFixed(2) + "%");
      nav.style.setProperty("--indicator-pointer-y", Math.max(0, Math.min(100, y)).toFixed(2) + "%");
    }

    function moveTo(link) {
      var navRect = nav.getBoundingClientRect();
      var linkRect = link.getBoundingClientRect();
      var padX = 2;
      var padY = 2;

      activeLink = link;
      window.clearTimeout(hideTimer);

      links.forEach(function (item) {
        item.classList.toggle("is-glass-active", item === link);
      });

      setIndicatorBox({
        x: linkRect.left - navRect.left - padX, y: linkRect.top - navRect.top - padY,
        width: linkRect.width + padX * 2, height: linkRect.height + padY * 2
      });
      nav.classList.add("is-indicator-active");
    }

    function moveToCurrent() {
      if (!currentLink) {
        nav.classList.remove("is-indicator-active");
        links.forEach(function (item) {
          item.classList.remove("is-glass-active");
        });
        activeLink = null;
        return;
      }

      moveTo(currentLink);
      nav.style.setProperty("--indicator-pointer-x", "50%");
      nav.style.setProperty("--indicator-pointer-y", "86%");
    }

    function hideSoon() {
      hideTimer = window.setTimeout(function () {
        if (nav.matches(":hover") || nav.contains(document.activeElement)) return;
        moveToCurrent();
      }, 90);
    }

    links.forEach(function (link) {
      link.addEventListener("click", function (event) {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
        var destination = new URL(link.getAttribute("href"), window.location.href);
        if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
        pendingDestination = destination.href;
        saveDeparture();
      });

      link.addEventListener("pointerenter", function (event) {
        moveTo(link);
        setPointer(event, link);
      });

      link.addEventListener("pointermove", function (event) {
        if (activeLink !== link) moveTo(link);
        setPointer(event, link);
      });

      link.addEventListener("focus", function () {
        moveTo(link);
        nav.style.setProperty("--indicator-pointer-x", "50%");
        nav.style.setProperty("--indicator-pointer-y", "86%");
      });
    });

    nav.addEventListener("pointerleave", hideSoon);
    nav.addEventListener("focusout", hideSoon);

    window.addEventListener("resize", function () {
      if (activeLink) moveTo(activeLink);
    }, { passive: true });

    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        if (activeLink) moveTo(activeLink);
      }).observe(nav);
    }

    if (document.fonts) {
      document.fonts.ready.then(function () {
        if (activeLink) moveTo(activeLink);
      });
    }

    // Capture the final animation position just before this document leaves.
    window.addEventListener("pagehide", saveDeparture);
    window.addEventListener("pageshow", function (event) {
      if (event.persisted) {
        pendingDestination = null;
        placeInitialIndicator(null);
      }
    });

    placeInitialIndicator(readDeparture());
  }

  function initMastheadRefraction() {
    if (!window.Hyalite) return;

    var glass = document.querySelector(".masthead__glass");
    var indicator = document.querySelector(".masthead-glass-indicator");
    if (!glass) return;

    // Independent sibling surfaces keep the text out of the refraction filter.
    Hyalite.attach(glass, {
      bevel: 18, thickness: 32, slope: 1.8, shape: "squircle",
      blur: 1.2, dispersion: 0.6, shade: 0.22, rim: 1.2,
      edgeW: 4, edge: 0.38, sat: 0.95, materialize: 220
    });
    if (indicator) {
      Hyalite.attach(indicator, {
        bevel: 10, thickness: 18, slope: 0.8, shape: "squircle",
        blur: 0.6, dispersion: 0, shade: 0.16, rim: 1,
        edgeW: 3, edge: 0.3, sat: 1, settle: 100
      });
    }
  }

  function initGalleryPreview() {
    var links = Array.prototype.slice.call(document.querySelectorAll(".gallery-card__link"));
    if (!links.length) return;

    var lightbox = document.createElement("div");
    lightbox.className = "gallery-lightbox";
    lightbox.setAttribute("role", "dialog");
    lightbox.setAttribute("aria-modal", "true");
    lightbox.setAttribute("aria-label", "Image preview");
    lightbox.innerHTML = '<button class="gallery-lightbox__close" type="button" aria-label="Close image preview">&times;</button><img class="gallery-lightbox__image" alt="">';
    document.body.appendChild(lightbox);

    var image = lightbox.querySelector(".gallery-lightbox__image");
    var closeButton = lightbox.querySelector(".gallery-lightbox__close");

    function openPreview(link) {
      var thumbnail = link.querySelector("img");

      image.src = link.getAttribute("href");
      image.alt = thumbnail ? thumbnail.getAttribute("alt") || "" : "";
      document.body.classList.add("gallery-lightbox-open");
      lightbox.classList.add("is-visible");
      closeButton.focus();
    }

    function closePreview() {
      lightbox.classList.remove("is-visible");
      document.body.classList.remove("gallery-lightbox-open");
      image.removeAttribute("src");
    }

    links.forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        openPreview(link);
      });
    });

    lightbox.addEventListener("click", function (event) {
      if (event.target === lightbox) closePreview();
    });

    closeButton.addEventListener("click", closePreview);

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && lightbox.classList.contains("is-visible")) closePreview();
    });
  }

  function initBackToTop() {
    var button = document.querySelector(".back-to-top");
    if (!button) return;

    var isShown = false;
    var isLocked = false;

    function handleScroll() {
      if (isLocked) return;

      if (window.scrollY >= 800) {
        if (!isShown) {
          button.classList.add("show");
          isShown = true;
        }
      } else if (isShown) {
        button.classList.remove("show");
        isShown = false;
      }
    }

    function handleClick() {
      isLocked = true;
      button.classList.add("ani-leave");
      window.scrollTo({ top: 0, behavior: "smooth" });

      window.setTimeout(function () {
        button.classList.remove("ani-leave");
        button.classList.add("leaved");
      }, 390);

      window.setTimeout(function () {
        button.classList.add("ending");
      }, 120);

      window.setTimeout(function () {
        button.classList.remove("show");
      }, 1500);

      window.setTimeout(function () {
        isLocked = false;
        isShown = false;
        button.classList.remove("leaved", "ending");
      }, 2000);
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    button.addEventListener("click", handleClick);
    handleScroll();
  }

  function initDeferredVisitors() {
    function runWhenIdle(callback) {
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(callback, { timeout: 2500 });
        return;
      }

      window.setTimeout(callback, 1200);
    }

    function loadCounterImages() {
      var counters = Array.prototype.slice.call(document.querySelectorAll("img.counter[data-deferred-src]"));

      counters.forEach(function (image) {
        image.src = image.getAttribute("data-deferred-src");
        image.removeAttribute("data-deferred-src");
      });
    }

    function loadClustrMaps() {
      var placeholder = document.querySelector("script#clustrmaps[data-deferred-src]");
      if (!placeholder) return;

      var script = document.createElement("script");
      script.id = placeholder.id;
      script.async = true;
      script.src = placeholder.getAttribute("data-deferred-src");
      placeholder.replaceWith(script);
    }

    function loadVisitors() {
      runWhenIdle(function () {
        loadCounterImages();
        loadClustrMaps();
      });
    }

    if (document.readyState === "complete") {
      loadVisitors();
    } else {
      window.addEventListener("load", loadVisitors, { once: true });
    }
  }

  function initSite() {
    initMasthead();
    initMastheadGlassIndicator();
    initMastheadRefraction();
    initGalleryPreview();
    initBackToTop();
    initDeferredVisitors();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSite);
  } else {
    initSite();
  }
})();
