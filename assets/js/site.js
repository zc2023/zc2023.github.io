(function () {
  function initMasthead() {
    var masthead = document.querySelector(".masthead");
    if (!masthead) return;

    function update() {
      masthead.classList.toggle("is-scrolled", window.scrollY > 12);
    }

    update();
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

        return normalizePath(linkUrl.pathname) === currentPath;
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
      var padX = 8;
      var padY = 5;

      activeLink = link;
      window.clearTimeout(hideTimer);

      links.forEach(function (item) {
        item.classList.toggle("is-glass-active", item === link);
      });

      nav.style.setProperty("--indicator-x", (linkRect.left - navRect.left - padX).toFixed(2) + "px");
      nav.style.setProperty("--indicator-y", (linkRect.top - navRect.top - padY).toFixed(2) + "px");
      nav.style.setProperty("--indicator-width", (linkRect.width + padX * 2).toFixed(2) + "px");
      nav.style.setProperty("--indicator-height", (linkRect.height + padY * 2).toFixed(2) + "px");
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

    window.addEventListener("scroll", function () {
      if (activeLink) moveTo(activeLink);
    }, { passive: true });

    window.setTimeout(moveToCurrent, 0);
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initMasthead();
      initMastheadGlassIndicator();
      initGalleryPreview();
    });
  } else {
    initMasthead();
    initMastheadGlassIndicator();
    initGalleryPreview();
  }
})();
