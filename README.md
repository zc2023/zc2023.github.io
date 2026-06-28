# Cheng Zhang Personal Website

Jekyll/GitHub Pages site for `zc2023.github.io`.

## Edit Guide

Change navigation bar: `_data/navigation.yml`

Change homepage structured content: `_data/home.yml`

Change homepage page structure: `_pages/about.md`

Change homepage visual styles: `_sass/_custom.scss`

Homepage publication cards are rendered by: `_includes/home-publications.html`

Homepage timeline/list entries are rendered by: `_includes/home-list-section.html`

Other information pages live in: `_pages/`

Change left sidebar profile information: `_config.yml`

Change left sidebar icons and email display: `_includes/author-profile.html`

Change left sidebar icon styles: `assets/css/academicons.css`

Change website tab icon/head resources: `_includes/head/custom.html`

Change footer: `_includes/footer.html`

## Local Environment

This project uses Ruby `3.2.2` via `.ruby-version` and Bundler `2.7.2` from `Gemfile.lock`.

If you use `rbenv`:

```bash
eval "$(rbenv init - zsh)"
rbenv install 3.2.2
bundle install
```

Run the local server:

```bash
bundle exec jekyll serve --config _config.yml,_config.dev.yml
```

Build check:

```bash
bundle exec jekyll build --config _config.yml,_config.dev.yml
```

If your shell still uses macOS system Ruby, put rbenv shims first in `PATH` or restart the terminal.

## Notes

The site is based on AcademicPages/Minimal Mistakes, with unused template comments, analytics providers, old jQuery assets, sample drafts, and template helper files removed for a leaner personal-site structure.

Generated output in `_site/` is ignored by Git.
