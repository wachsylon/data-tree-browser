# data-tree-browser
In-browser Xarray DataTree viewer

## Deploy to GitHub Pages

- Push to `main`. The workflow in `.github/workflows/pages.yml` will:
  - Validate the default Zarr URL by fetching `/.zmetadata`.
  - Upload the static site and deploy to GitHub Pages.
- Ensure Pages is enabled in repo Settings → Pages → Build and deployment → GitHub Actions.

## Usage

- Open the deployed site and click Load, or enter a Zarr store base URL.
- Requirement: the store must provide consolidated `/.zmetadata` and allow CORS from browsers.
- Default test URL:
  - `https://s3.eu-dkrz-1.dkrz.cloud/wrcp-hackathon/data/ICON/d3hp003.zarr`

## Notes

- The app is static (no build needed) and served as-is: `index.html`, `styles.css`, `app.js`.
- Keyboard navigation: Up (parent), Down (first child), Left/Right (siblings).
