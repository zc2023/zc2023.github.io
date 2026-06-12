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

  function initFloatingNav() {
    var nav = document.querySelector(".floating-nav");
    if (!nav) return;

    function update() {
      nav.classList.toggle("is-visible", window.scrollY >= 400);
    }

    update();
    window.addEventListener("scroll", update, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initMasthead();
      initFloatingNav();
    });
  } else {
    initMasthead();
    initFloatingNav();
  }
})();
